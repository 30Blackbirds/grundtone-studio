<script setup lang="ts">
  import type { Tokens } from '~~/server/lib/tokens'

  definePageMeta({ layout: 'app' })

  const { t } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)
  const projectSlug = computed(() => route.params.projectSlug as string)
  const { isAdmin } = useOrgContext()

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
  const saveError = ref<string | null>(null)

  async function saveDraft() {
    if (!project.value?.id) return
    saving.value = true
    saveError.value = null
    try {
      await $fetch(`/api/projects/${project.value.id}/config`, {
        method: 'POST',
        body: tokens.value,
      })
      initialTokens.value = JSON.stringify(tokens.value)
      await refreshConfig()
    } catch (err) {
      saveError.value = (err as Error).message
    } finally {
      saving.value = false
    }
  }

  function discardChanges() {
    tokens.value =
      config.value?.draft?.tokens ?? config.value?.active?.tokens ?? config.value?.defaults ?? {}
    initialTokens.value = JSON.stringify(tokens.value)
  }
</script>

<template>
  <section class="p-6">
    <nav class="flex gap-2 text-tertiary text-sm mb-4">
      <NuxtLink to="/dashboard">{{ t('orgs.title') }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/orgs/${slug}`">{{ t('projects.title') }}</NuxtLink>
      <span>/</span>
      <span>{{ project?.name ?? projectSlug }}</span>
    </nav>

    <header class="mb-6 flex justify-between items-center">
      <div>
        <h1 class="m-0">{{ project?.name ?? projectSlug }}</h1>
        <p v-if="config?.active" class="text-tertiary mt-1 text-sm">
          {{ t('project.active', { version: config.active.version }) }}
        </p>
        <p v-else class="text-tertiary mt-1 text-sm">{{ t('project.notPublished') }}</p>
      </div>
      <div v-if="isDirty" class="flex gap-3">
        <GTButton variant="secondary" :disabled="saving" @click="discardChanges">
          {{ t('project.discard') }}
        </GTButton>
        <GTButton :loading="saving" @click="saveDraft">{{ t('project.saveDraft') }}</GTButton>
      </div>
    </header>

    <GTAlert v-if="saveError" variant="error" :heading="saveError" class="mb-4" />

    <GTTabs
      v-if="project"
      :tabs="[
        { id: 'tokens', label: t('project.tabTokens') },
        { id: 'apiKeys', label: t('apiKeys.title') },
      ]"
    >
      <template #tokens>
        <div class="grid grid-cols-2 gap-6">
          <TokenEditor v-model="tokens" />
          <div class="sticky top-4 self-start">
            <TokenPreview :tokens="tokens" />
          </div>
        </div>
      </template>

      <template #apiKeys>
        <ApiKeyManager :project-id="project.id" :can-manage="isAdmin" />
      </template>
    </GTTabs>
  </section>
</template>
