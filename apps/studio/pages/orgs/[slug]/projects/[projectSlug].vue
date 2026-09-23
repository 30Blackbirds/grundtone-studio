<script setup lang="ts">
  import type { Tokens } from '~~/server/lib/tokens'

  definePageMeta({ layout: 'app' })

  // Client-rendered (see routeRules `/orgs/**` ssr:false in nuxt.config): this is
  // an authenticated, interactive token editor with no SEO value, and direct/SSR
  // loads hit "[nuxt] instance unavailable" from composables that run after the
  // data awaits below. Rendering on the client sidesteps that class entirely.
  const { t } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)
  const projectSlug = computed(() => route.params.projectSlug as string)

  interface ProjectRow {
    id: string
    slug: string
    name: string
  }

  const { data: project } = await useAsyncData<ProjectRow | null>(
    () => `project-${slug.value}-${projectSlug.value}`,
    async () => {
      const projects = await $fetch<ProjectRow[]>('/api/projects', {
        headers: useRequestHeaders(['cookie']),
        query: { organizationSlug: slug.value },
      })
      return projects.find((p) => p.slug === projectSlug.value) ?? null
    },
  )

  // Two-layer permissions: effective project role drives every UI gate on
  // this page. Sentry-style mapping (see server/lib/project-access.ts):
  // org owner/manager → project:admin; org admin/member → project:viewer;
  // org billing → no access. Direct project members get exactly the role they
  // were invited for, and the effective role is max(org-mapped, direct).
  const projectId = computed(() => project.value?.id ?? null)
  const { canEdit, canManage } = useProjectRole(projectId)

  interface ConfigResponse {
    draft: { id: string; version: number; tokens: Tokens } | null
    active: { id: string; version: number; tokens: Tokens; publishedAt: string | null } | null
    defaults: Tokens
  }

  const { data: config, refresh: refreshConfig } = await useAsyncData<ConfigResponse | null>(
    () => `config-${project.value?.id ?? 'none'}`,
    async () => {
      if (!project.value?.id) return null
      return await $fetch<ConfigResponse>(`/api/projects/${project.value.id}/config`, {
        headers: useRequestHeaders(['cookie']),
      })
    },
  )

  const tokens = ref<Tokens>(
    config.value?.draft?.tokens ?? config.value?.active?.tokens ?? config.value?.defaults ?? {},
  )

  const initialTokens = ref(JSON.stringify(tokens.value))
  const isDirty = computed(() => JSON.stringify(tokens.value) !== initialTokens.value)
  const saving = ref(false)
  const publishing = ref(false)
  const error = ref<string | null>(null)
  // Active-brand cap (riff bfxmm7xktk6xkfanh5eennva): a plan limit, not a
  // failure — rendered like the project quota on the org page, not as an error.
  const brandLimit = ref<number | null>(null)
  const toast = useToast()

  async function saveDraft(opts: { silent?: boolean } = {}) {
    if (!project.value?.id) return
    saving.value = true
    error.value = null
    try {
      await $fetch(`/api/projects/${project.value.id}/config`, {
        method: 'POST',
        body: tokens.value,
      })
      initialTokens.value = JSON.stringify(tokens.value)
      await refreshConfig()
      // Silent when called as part of publish — one toast per user action.
      if (!opts.silent) toast.success(t('toasts.draftSaved'))
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      saving.value = false
    }
  }

  async function publish() {
    if (!project.value?.id) return
    publishing.value = true
    error.value = null
    brandLimit.value = null
    try {
      if (isDirty.value) await saveDraft({ silent: true })
      await $fetch(`/api/projects/${project.value.id}/publish`, { method: 'POST' })
      await refreshConfig()
      toast.success(t('toasts.published'))
    } catch (err) {
      const data = (err as { data?: { data?: { code?: string; limit?: number } } }).data?.data
      if (data?.code === 'brand_quota_exceeded') {
        brandLimit.value = data.limit ?? 0
      } else {
        error.value = (err as Error).message
      }
    } finally {
      publishing.value = false
    }
  }

  function discardChanges() {
    tokens.value =
      config.value?.draft?.tokens ?? config.value?.active?.tokens ?? config.value?.defaults ?? {}
    initialTokens.value = JSON.stringify(tokens.value)
  }

  // Editor mode drives the live preview: in dark mode the preview renders the
  // EFFECTIVE tokens (base with dark.colors merged) — mirrors the server-side
  // resolveMode without pulling that (zod-adjacent) module into the client.
  const editorMode = ref<'base' | 'dark'>('base')
  const previewTokens = computed<Tokens>(() => {
    const { dark, ...base } = tokens.value
    if (editorMode.value !== 'dark' || !dark?.colors) return base
    return { ...base, colors: { ...base.colors, ...dark.colors } }
  })

  const hasDraft = computed(() => Boolean(config.value?.draft))

  // Export lives in a modal opened from the header action above.
  const showExport = ref(false)
</script>

<template>
  <section class="p-6">
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <header class="mb-6 flex justify-between items-center">
      <div>
        <h1 class="m-0">{{ project?.name ?? projectSlug }}</h1>
        <p v-if="config?.active" class="text-tertiary mt-1 text-sm">
          {{ t('project.active', { version: config.active.version }) }}
        </p>
        <p v-else class="text-tertiary mt-1 text-sm">{{ t('project.notPublished') }}</p>
      </div>
      <div class="flex gap-3">
        <GTButton
          v-if="isDirty"
          variant="secondary"
          :disabled="saving || publishing"
          @click="discardChanges"
        >
          {{ t('project.discard') }}
        </GTButton>
        <GTButton
          v-if="isDirty && canEdit"
          variant="secondary"
          :loading="saving"
          :disabled="publishing"
          @click="saveDraft()"
        >
          {{ t('project.saveDraft') }}
        </GTButton>
        <GTButton
          v-if="canEdit && (isDirty || hasDraft)"
          :loading="publishing"
          :disabled="saving"
          @click="publish"
        >
          {{ t('project.publish') }}
        </GTButton>
        <!-- 🔴 AN ACTION, NOT A TAB (KH-1005 E8, verbatim: "en 'Eksportér
             (DTCG)'-HANDLING på projektsiden, der viser eksport-rapporten, når
             noget blev udeladt"). The IA prototype names the project tab bar
             exactly: Tokens/Komponenter/API-nøgler/Versioner/Medlemmer — five
             tabs, and export is not among them. It shipped as a sixth tab; no
             decision anywhere named it one. Export is available to every role
             that can see the project and on every plan, so it does not sit
             behind `canEdit`: the tokens are the customer's. -->
        <GTButton variant="secondary" @click="showExport = true">
          {{ t('dtcgExport.action') }}
        </GTButton>
      </div>
    </header>

    <GTAlert v-if="error" variant="error" :heading="error" class="mb-4" />
    <GTAlert
      v-if="brandLimit !== null"
      variant="info"
      :heading="t('quota.brandHeading')"
      class="mb-4"
    >
      <p class="m-0 mb-3">{{ t('quota.brandBody', { limit: brandLimit }) }}</p>
      <div class="flex gap-3 items-center">
        <GTButton size="sm" @click="navigateTo(`/plans?org=${slug}`)">
          {{ t('quota.cta') }}
        </GTButton>
        <GTButton variant="unstyled" size="sm" @click="brandLimit = null">
          {{ t('quota.later') }}
        </GTButton>
      </div>
    </GTAlert>

    <GTTabs
      v-if="project"
      :tabs="[
        { id: 'tokens', label: t('project.tabTokens') },
        { id: 'components', label: t('project.tabComponents') },
        { id: 'apiKeys', label: t('apiKeys.title') },
        { id: 'versions', label: t('versions.title') },
        { id: 'members', label: t('projectMembers.title') },
      ]"
    >
      <GTTabPanel id="tokens">
        <!-- 🔴 THE PUBLISH BAR (KH-1029, redesign-brand-assets.html). It says
             what state this tab's content is in and that the three things in
             it — colours, logo, fonts — are ONE draft. The prototype puts it
             directly under the tab bar, above the first card, because the note
             is about everything below it and not about the brand section alone.

             🔴 IT CARRIES NO PUBLISH BUTTON, AND THE PROTOTYPE HAS ONE. Publish
             already lives in the page header a few centimetres above, together
             with Discard and Save draft, and a second button firing the same
             action is a usability decision rather than an implementation
             detail — two publish buttons on one screen invite the question of
             whether they do the same thing. The riff's gap list names "the
             pubbar with 'Kladde' badge and the note", not the button.
             [designer] decides whether the action should be duplicated here. -->
        <div v-if="canEdit || hasDraft" class="pubbar">
          <strong class="pubbar__title">{{ t('project.tabTokens') }}</strong>
          <GTBadge v-if="isDirty || hasDraft" variant="warning" size="sm">
            {{ t('dashboard.status.draft') }}
          </GTBadge>
          <span class="pubbar__note text-tertiary">
            {{ t('brandAssets.publishTogetherNote') }}
          </span>
        </div>

        <!-- In-app-hjælp v1 (launch-krav: self-serve-support): publicerings-
             flowet er support-driver #1 — forklaringen bor hvor beslutningen
             tages, ikke i et eksternt dok. -->
        <GTDetails :summary="t('help.publishHelp.summary')" variant="subtle" class="mb-4">
          <ul class="m-0 pl-4 text-sm flex flex-col gap-2">
            <li>{{ t('help.publishHelp.draft') }}</li>
            <li>{{ t('help.publishHelp.publish') }}</li>
            <li>{{ t('help.publishHelp.versions') }}</li>
          </ul>
        </GTDetails>
        <div class="editor-layout">
          <TokenEditor v-model="tokens" v-model:mode="editorMode" />
          <div class="editor-layout__preview">
            <ClientOnly>
              <TokenPreview :tokens="previewTokens" />
            </ClientOnly>
          </div>
        </div>
        <!-- Brand-assets (logo + skrifttype) — sektion HER, ikke egen fane:
             assets publiceres med farve-tokens i samme kladde/publicér-cyklus
             (forlæg redesign-brand-assets.html). -->
        <ClientOnly>
          <BrandAssetsSection v-model="tokens" :project-id="project.id" :can-edit="canEdit" />
        </ClientOnly>
      </GTTabPanel>

      <!-- Workbench renders the LIVE editor state (previewTokens), so
           unsaved colour/spacing changes from the tokens tab show up here
           immediately — that's the point of having it at project level. -->
      <GTTabPanel id="components">
        <ClientOnly>
          <ComponentWorkbench :tokens="previewTokens" :mode="editorMode" />
        </ClientOnly>
      </GTTabPanel>

      <GTTabPanel id="apiKeys">
        <ApiKeyManager :project-id="project.id" :can-manage="canManage" />
      </GTTabPanel>

      <GTTabPanel id="versions">
        <VersionHistory :project-id="project.id" :can-manage="canEdit" @activated="refreshConfig" />
      </GTTabPanel>

      <GTTabPanel id="members">
        <ProjectMembersManager :project-id="project.id" :can-manage="canManage" />
      </GTTabPanel>
    </GTTabs>

    <!-- The export report is the point of the action, so it opens where it can
         be read without leaving the project (KH-1005 E8). -->
    <GTModal :open="showExport" :title="t('dtcgExport.title')" @update:open="showExport = $event">
      <DtcgExport
        v-if="project"
        hide-heading
        :project-id="project.id"
        :has-draft="Boolean(config?.draft)"
        :has-active="Boolean(config?.active)"
        :revision="`${config?.active?.id ?? ''}:${initialTokens}`"
      />
    </GTModal>
  </section>
</template>
