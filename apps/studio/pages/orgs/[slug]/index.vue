<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'
  import type { DashboardPayload } from '~~/server/lib/dashboard'

  definePageMeta({ layout: 'app' })

  const { t, d } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)

  const { data: org } = await useAsyncData(`org-${slug.value}`, async () => {
    const res = await organization.getFullOrganization({
      query: { organizationSlug: slug.value },
      fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
    })
    return res.data
  })

  watchEffect(async () => {
    if (org.value?.id) {
      await organization.setActive({ organizationId: org.value.id })
    }
  })

  // Reuses the dashboard aggregate (R2) so the grid gets publish status +
  // brand swatch without a bespoke endpoint; filtered to this org client-side.
  const { data: dash, refresh } = await useAsyncData<DashboardPayload>(
    `org-overview-${slug.value}`,
    () =>
      $fetch<DashboardPayload>('/api/dashboard', {
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => ({ orgs: [], projects: [], activity: [] }) },
  )
  const projects = computed(() => dash.value.projects.filter((p) => p.orgSlug === slug.value))

  // Create-project lives in a modal (UX-audit finding #6).
  const showCreate = ref(false)
  const projName = ref('')
  const projSlug = ref('')
  const creating = ref(false)
  const error = ref<string | null>(null)

  async function create() {
    creating.value = true
    error.value = null
    try {
      await $fetch('/api/projects', {
        method: 'POST',
        body: { name: projName.value, slug: projSlug.value, organizationSlug: slug.value },
      })
      showCreate.value = false
      projName.value = ''
      projSlug.value = ''
      await refresh()
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      creating.value = false
    }
  }

  function statusVariant(
    status: 'published' | 'draft' | 'none',
  ): 'success' | 'warning' | 'neutral' {
    if (status === 'published') return 'success'
    if (status === 'draft') return 'warning'
    return 'neutral'
  }
</script>

<template>
  <section class="p-6">
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <header class="flex justify-between items-center mb-6">
      <div>
        <h1 class="m-0">{{ org?.name ?? slug }}</h1>
        <p class="text-tertiary mt-1 text-sm m-0">{{ t('projects.title') }}</p>
      </div>
      <GTButton @click="showCreate = true">{{ t('projects.new') }}</GTButton>
    </header>

    <div v-if="projects.length" class="dash-grid">
      <NuxtLink
        v-for="p in projects"
        :key="p.id"
        :to="`/orgs/${slug}/projects/${p.slug}`"
        class="dash-card bg-surface-raised border rounded-lg no-underline text-inherit"
      >
        <div class="flex items-center gap-2">
          <!-- Swatch color is per-project DATA (the brand's published primary
               token), not theming — same precedent as the dashboard grid. -->
          <span
            v-if="p.primaryColor"
            class="dash-swatch"
            :style="{ background: p.primaryColor }"
            aria-hidden="true"
          />
          <strong>{{ p.name }}</strong>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <GTBadge :variant="statusVariant(p.status)">
            {{ t(`dashboard.status.${p.status}`) }}
          </GTBadge>
          <span v-if="p.publishedAt" class="text-tertiary text-sm">
            {{ d(new Date(p.publishedAt), 'short') }}
          </span>
        </div>
      </NuxtLink>
    </div>
    <div v-else class="p-6 bg-surface-raised border rounded-lg">
      <p class="m-0 mb-2 text-tertiary">{{ t('projects.empty') }}</p>
      <GTButton variant="secondary" size="sm" @click="showCreate = true">
        {{ t('dashboard.noProjectsCta') }}
      </GTButton>
    </div>

    <GTModal :open="showCreate" :title="t('projects.new')" @update:open="showCreate = $event">
      <form id="create-project-form" class="flex flex-col gap-4" @submit.prevent="create">
        <GTInput v-model="projName" :label="t('projects.nameLabel')" required />
        <GTInput
          v-model="projSlug"
          :label="t('projects.slugLabel')"
          required
          pattern="[a-z0-9-]+"
        />
        <GTAlert v-if="error" variant="error" :heading="error" />
      </form>
      <template #footer>
        <div class="flex gap-3 justify-end">
          <GTButton type="button" variant="secondary" @click="showCreate = false">
            {{ t('app.cancel') }}
          </GTButton>
          <GTButton type="submit" form="create-project-form" :loading="creating">
            {{ t('app.create') }}
          </GTButton>
        </div>
      </template>
    </GTModal>
  </section>
</template>
