<script setup lang="ts">
  definePageMeta({ layout: 'app' })

  const { t, d } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)
  const { activeOrg, canManageOrgMembers } = useOrgContext()

  interface AuditRow {
    id: string
    organizationId: string
    actorUserId: string | null
    actorEmail: string | null
    action: string
    targetType: string | null
    targetId: string | null
    targetLabel: string | null
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    ipAddress: string | null
    userAgent: string | null
    createdAt: string
  }

  // Sentry-style 5-tier role rule: only manager+owner can see the audit log.
  // We still render the page shell for everyone else so the URL doesn't 404
  // — the empty state explains why.

  const ACTION_FILTERS = [
    'all',
    'member.invited',
    'member.added',
    'member.removed',
    'member.role_changed',
    'project.created',
    'api_key.created',
    'api_key.revoked',
    'config.published',
    'config.activated',
  ] as const

  const actionFilter = ref<(typeof ACTION_FILTERS)[number]>('all')

  const { data, refresh, status } = await useAsyncData<{
    items: AuditRow[]
    nextBefore: string | null
  } | null>(
    () => `audit-${activeOrg.value?.id ?? 'none'}-${actionFilter.value}`,
    async () => {
      if (!activeOrg.value?.id || !canManageOrgMembers.value) return null
      const fetcher = $fetch as (
        url: string,
        opts?: unknown,
      ) => Promise<{ items: AuditRow[]; nextBefore: string | null }>
      const qs = new URLSearchParams()
      if (actionFilter.value !== 'all') qs.set('action', actionFilter.value)
      return await fetcher(
        `/api/orgs/${activeOrg.value.id}/audit${qs.toString() ? '?' + qs.toString() : ''}`,
        { headers: useRequestHeaders(['cookie']) },
      )
    },
    { default: () => null, watch: [activeOrg, actionFilter] },
  )

  // Per Sentry's convention, the action's i18n label lives under
  // `audit.actions.<action>`. The before/after JSON gets rendered inline as a
  // small key=value summary. Long-form audit-trail forensics happens elsewhere
  // (downloadable export or warehouse) — this page is for daily monitoring.
  function summary(row: AuditRow): string {
    if (row.before && row.after && 'role' in row.before && 'role' in row.after) {
      return `${row.before.role} → ${row.after.role}`
    }
    if (row.after && 'role' in row.after) return String(row.after.role)
    if (row.after && 'version' in row.after) return `v${row.after.version}`
    return ''
  }
</script>

<template>
  <section class="p-6 max-w-5xl mx-auto flex flex-col gap-4">
    <nav class="flex gap-2 text-tertiary text-sm">
      <NuxtLink :to="`/orgs/${slug}`">{{ activeOrg?.name ?? slug }}</NuxtLink>
      <span>›</span>
      <span>{{ t('audit.title') }}</span>
    </nav>

    <header class="flex justify-between items-center mb-2">
      <div>
        <h1 class="m-0 font-heading">{{ t('audit.title') }}</h1>
        <p class="text-tertiary m-0 mt-1">{{ t('audit.intro') }}</p>
      </div>
    </header>

    <GTAlert v-if="!canManageOrgMembers" variant="info" :heading="t('audit.restrictedHeading')">
      {{ t('audit.restrictedBody') }}
    </GTAlert>

    <template v-else>
      <div class="flex gap-3 items-center">
        <label class="text-tertiary text-sm">{{ t('audit.filterByAction') }}</label>
        <GTSelect
          v-model="actionFilter"
          :options="ACTION_FILTERS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) }))"
        />
        <GTButton variant="outlined" size="sm" :loading="status === 'pending'" @click="refresh()">
          {{ t('audit.refresh') }}
        </GTButton>
      </div>

      <section
        v-if="data?.items?.length"
        class="border rounded-lg overflow-hidden bg-surface-raised"
      >
        <ul class="list-reset m-0">
          <li
            v-for="row in data.items"
            :key="row.id"
            class="grid grid-cols-[auto_1fr_auto] gap-4 items-center px-4 py-3 border-b last:border-b-0"
          >
            <GTBadge variant="neutral">{{ t(`audit.actions.${row.action}`) }}</GTBadge>
            <div class="flex flex-col gap-0.5">
              <span class="text-sm">
                <strong>{{ row.actorEmail ?? t('audit.systemActor') }}</strong>
                <template v-if="row.targetLabel"> · {{ row.targetLabel }} </template>
                <template v-if="summary(row)">
                  · <code class="text-tertiary">{{ summary(row) }}</code>
                </template>
              </span>
              <span class="text-tertiary text-xs">
                {{ d(new Date(row.createdAt), 'long') }}
                <template v-if="row.ipAddress"> · {{ row.ipAddress }}</template>
              </span>
            </div>
            <span />
          </li>
        </ul>
        <footer
          v-if="data.nextBefore"
          class="px-4 py-3 border-t bg-surface text-tertiary text-xs text-center"
        >
          {{ t('audit.olderHint') }}
        </footer>
      </section>

      <p v-else-if="status !== 'pending'" class="text-tertiary text-sm py-12 text-center m-0">
        {{ t('audit.empty') }}
      </p>
    </template>
  </section>
</template>
