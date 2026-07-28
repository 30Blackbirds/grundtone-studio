<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'
  import type { DashboardPayload } from '~~/server/lib/dashboard'

  definePageMeta({ layout: 'app' })

  const { t, d } = useI18n()

  const { data: dash, refresh } = await useAsyncData<DashboardPayload>(
    'dashboard',
    () =>
      $fetch<DashboardPayload>('/api/dashboard', {
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => ({ orgs: [], projects: [], activity: [] }) },
  )

  // Authed users with no orgs land in the onboarding wizard instead of an
  // empty dashboard. Runs only on the client because navigateTo during SSR
  // breaks the auth-cookie round-trip on first signup.
  onMounted(() => {
    if ((dash.value?.orgs.length ?? 0) === 0) navigateTo('/onboarding')
  })

  const publishedCount = computed(
    () => dash.value.projects.filter((p) => p.status === 'published').length,
  )
  const lastPublishedAt = computed(() => {
    const dates = dash.value.projects
      .map((p) => p.publishedAt)
      .filter((x): x is string => Boolean(x))
      .sort()
    return dates.length ? dates[dates.length - 1] : null
  })

  // Create-org lives in a modal (UX-audit finding #6: inline-expanding forms
  // push content around).
  const showCreate = ref(false)
  const orgName = ref('')
  const orgSlug = ref('')
  const creating = ref(false)
  const error = ref<string | null>(null)

  async function create() {
    creating.value = true
    error.value = null
    const res = await organization.create({ name: orgName.value, slug: orgSlug.value })
    creating.value = false
    if (res.error) {
      error.value = res.error.message ?? t('orgs.createError')
      return
    }
    showCreate.value = false
    orgName.value = ''
    orgSlug.value = ''
    await refresh()
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
    <header class="flex justify-between items-center mb-6">
      <div>
        <h1 class="m-0">{{ t('dashboard.title') }}</h1>
        <p class="text-tertiary mt-1 text-sm m-0">{{ t('dashboard.subtitle') }}</p>
      </div>
      <GTButton @click="showCreate = true">{{ t('orgs.new') }}</GTButton>
    </header>

    <div class="dash-stats mb-6">
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">{{ dash.orgs.length }}</div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statOrgs') }}</div>
      </div>
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">{{ dash.projects.length }}</div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statProjects') }}</div>
      </div>
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">{{ publishedCount }}</div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statPublished') }}</div>
      </div>
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">
          {{ lastPublishedAt ? d(new Date(lastPublishedAt), 'short') : '—' }}
        </div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statLastPublish') }}</div>
      </div>
    </div>

    <section class="mb-8">
      <h2 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('dashboard.projectsHeading') }}
      </h2>
      <div v-if="dash.projects.length" class="dash-grid">
        <NuxtLink
          v-for="p in dash.projects"
          :key="p.id"
          :to="`/orgs/${p.orgSlug}/projects/${p.slug}`"
          class="dash-card bg-surface-raised border rounded-lg no-underline text-inherit"
        >
          <div class="flex items-center gap-2">
            <!-- Swatch color is per-project DATA (the brand's published primary
                 token), not theming — the one legitimate use of a style binding. -->
            <span
              v-if="p.primaryColor"
              class="dash-swatch"
              :style="{ background: p.primaryColor }"
              aria-hidden="true"
            />
            <strong>{{ p.name }}</strong>
          </div>
          <div class="flex items-center gap-2 mt-2">
            <span class="text-tertiary text-sm">{{ p.orgName }}</span>
            <GTBadge :variant="statusVariant(p.status)">
              {{ t(`dashboard.status.${p.status}`) }}
            </GTBadge>
          </div>
        </NuxtLink>
      </div>
      <div v-else class="p-6 bg-surface-raised border rounded-lg">
        <p class="m-0 text-tertiary">{{ t('dashboard.noProjects') }}</p>
        <NuxtLink v-if="dash.orgs.length" :to="`/orgs/${dash.orgs[0].slug}`" class="text-sm">
          {{ t('dashboard.noProjectsCta') }}
        </NuxtLink>
      </div>
    </section>

    <section v-if="dash.activity.length">
      <h2 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('dashboard.activityHeading') }}
      </h2>
      <ul class="list-reset flex flex-col gap-1">
        <li
          v-for="a in dash.activity"
          :key="a.id"
          class="flex items-center gap-3 p-3 bg-surface-raised border rounded-lg"
        >
          <GTBadge variant="neutral">{{ t(`audit.actions.${a.action}`) }}</GTBadge>
          <span v-if="a.targetLabel" class="text-sm">{{ a.targetLabel }}</span>
          <span class="text-tertiary text-sm dash-activity__meta">
            {{ a.actorEmail ?? '' }} · {{ d(new Date(a.createdAt), 'short') }}
          </span>
        </li>
      </ul>
    </section>

    <GTModal :open="showCreate" :title="t('orgs.new')" @update:open="showCreate = $event">
      <form id="create-org-form" class="flex flex-col gap-4" @submit.prevent="create">
        <GTInput v-model="orgName" :label="t('orgs.nameLabel')" required />
        <GTInput v-model="orgSlug" :label="t('orgs.slugLabel')" required pattern="[a-z0-9-]+" />
        <GTAlert v-if="error" variant="error" :heading="error" />
      </form>
      <template #footer>
        <div class="flex gap-3 justify-end">
          <GTButton type="button" variant="secondary" @click="showCreate = false">
            {{ t('app.cancel') }}
          </GTButton>
          <GTButton type="submit" form="create-org-form" :loading="creating">
            {{ t('app.create') }}
          </GTButton>
        </div>
      </template>
    </GTModal>
  </section>
</template>
