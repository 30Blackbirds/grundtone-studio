<script setup lang="ts">
  import { useToast } from '@grundtone/vue'
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
  // Quota errors get their own, non-scary rendering: this is a plan limit, not
  // a failure. Becomes the upgrade-CTA entry point when checkout lands.
  const quotaLimit = ref<number | null>(null)

  async function create() {
    creating.value = true
    error.value = null
    quotaLimit.value = null
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
      const data = (err as { data?: { data?: { code?: string; limit?: number } } }).data?.data
      if (data?.code === 'quota_exceeded') {
        quotaLimit.value = data.limit ?? 0
      } else {
        error.value = (err as Error).message
      }
    } finally {
      creating.value = false
    }
  }

  // Kontrakt §2: eksplicit entitlements-refetch på checkout-success-URL'en, så
  // opgraderingen føles øjeblikkelig (ellers op til 60s TTL).
  const router = useRouter()
  const toast = useToast()
  onMounted(async () => {
    if (route.query.upgrade === 'success') {
      toast.success(t('toasts.upgraded'))
      await $fetch('/api/billing/entitlements-refresh', {
        method: 'POST',
        body: { organizationSlug: slug.value },
      }).catch(() => {})
      await router.replace({ query: { ...route.query, upgrade: undefined } })
    }
  })

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
        <!-- Kvote-mødet, Flow A (designer billing-upgrade-flow v2): blød
             invitation med "Se planer" + dismiss — aldrig en blokerende fejl. -->
        <GTAlert v-if="quotaLimit !== null" variant="info" :heading="$t('quota.heading')">
          <p class="m-0 mb-2">{{ $t('quota.body') }}</p>
          <p class="m-0 mb-3 text-sm text-tertiary">
            {{ $t('quota.meter', { used: quotaLimit, limit: quotaLimit }) }}
          </p>
          <div class="flex gap-3 items-center">
            <GTButton size="sm" @click="navigateTo(`/plans?org=${slug}`)">
              {{ $t('quota.cta') }}
            </GTButton>
            <GTButton variant="unstyled" size="sm" @click="quotaLimit = null">
              {{ $t('quota.later') }}
            </GTButton>
          </div>
        </GTAlert>
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
