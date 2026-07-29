<script setup lang="ts">
  import { auditCsv, groupByDay } from '~~/utils/audit-export'

  definePageMeta({ layout: 'app' })

  const { t, d } = useI18n()
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

  interface AuditPage {
    items: AuditRow[]
    nextBefore: string | null
    nextBeforeId: string | null
  }

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
  const actorQuery = ref('')

  // Accumulated cursor pagination (UX-audit finding #13: the old page showed a
  // non-interactive "older entries exist" hint — now "load older" actually
  // appends the next page). Filters reset the accumulation.
  const rows = ref<AuditRow[]>([])
  const cursor = ref<{ before: string; beforeId: string } | null>(null)
  const hasMore = ref(false)
  const loading = ref(false)

  async function loadPage(reset: boolean) {
    if (!activeOrg.value?.id || !canManageOrgMembers.value) return
    loading.value = true
    try {
      const qs = new URLSearchParams()
      if (actionFilter.value !== 'all') qs.set('action', actionFilter.value)
      if (!reset && cursor.value) {
        qs.set('before', cursor.value.before)
        qs.set('beforeId', cursor.value.beforeId)
      }
      const fetcher = $fetch as (url: string, opts?: unknown) => Promise<AuditPage>
      const page = await fetcher(
        `/api/orgs/${activeOrg.value.id}/audit${qs.toString() ? '?' + qs.toString() : ''}`,
        { headers: useRequestHeaders(['cookie']) },
      )
      rows.value = reset ? page.items : [...rows.value, ...page.items]
      hasMore.value = page.nextBefore !== null
      cursor.value =
        page.nextBefore && page.nextBeforeId
          ? { before: page.nextBefore, beforeId: page.nextBeforeId }
          : null
    } finally {
      loading.value = false
    }
  }

  watch([activeOrg, actionFilter, canManageOrgMembers], () => loadPage(true), { immediate: true })

  // Actor search filters the LOADED rows client-side — labelled as such in the
  // UI. Server-side actor filtering needs userId (not email), which the
  // manager doesn't have at hand.
  const visibleRows = computed(() => {
    const q = actorQuery.value.trim().toLowerCase()
    if (!q) return rows.value
    return rows.value.filter((r) => (r.actorEmail ?? '').toLowerCase().includes(q))
  })

  const dayGroups = computed(() => groupByDay(visibleRows.value))

  const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  function exportCsv() {
    const csv = auditCsv(
      visibleRows.value.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        action: r.action,
        actorEmail: r.actorEmail,
        targetLabel: r.targetLabel,
        ipAddress: r.ipAddress,
      })),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${activeOrg.value?.slug ?? 'org'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Per Sentry's convention, the action's i18n label lives under
  // `audit.actions.<action>`. The before/after JSON gets rendered inline as a
  // small key=value summary. Long-form audit-trail forensics happens elsewhere
  // — this page is for daily monitoring; the CSV export covers handoffs.
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
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <header class="flex justify-between items-center mb-2">
      <div>
        <h1 class="m-0 font-heading">{{ t('audit.title') }}</h1>
        <p class="text-tertiary m-0 mt-1">
          {{ t('audit.intro') }} · {{ t('audit.timezoneNote', { tz: viewerTimeZone }) }}
        </p>
      </div>
      <GTButton
        v-if="canManageOrgMembers && visibleRows.length"
        variant="outlined"
        size="sm"
        @click="exportCsv"
      >
        {{ t('audit.exportCsv') }}
      </GTButton>
    </header>

    <GTAlert v-if="!canManageOrgMembers" variant="info" :heading="t('audit.restrictedHeading')">
      {{ t('audit.restrictedBody') }}
    </GTAlert>

    <template v-else>
      <div class="flex gap-3 items-end flex-wrap">
        <GTSelect
          v-model="actionFilter"
          :label="t('audit.filterByAction')"
          :options="ACTION_FILTERS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) }))"
        />
        <GTInput
          v-model="actorQuery"
          :label="t('audit.actorSearch')"
          :placeholder="t('audit.actorSearchPlaceholder')"
          size="sm"
        />
        <GTButton variant="outlined" size="sm" :loading="loading" @click="loadPage(true)">
          {{ t('audit.refresh') }}
        </GTButton>
      </div>

      <template v-if="dayGroups.length">
        <section
          v-for="group in dayGroups"
          :key="group.day"
          class="border rounded-lg overflow-hidden bg-surface-raised"
        >
          <h2
            class="m-0 px-4 py-2 bg-surface border-b text-tertiary text-xs uppercase tracking-wider font-medium"
          >
            {{ d(new Date(group.day), 'short') }}
          </h2>
          <ul class="list-reset m-0">
            <li
              v-for="row in group.rows"
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
        </section>

        <div v-if="hasMore" class="text-center">
          <GTButton variant="secondary" size="sm" :loading="loading" @click="loadPage(false)">
            {{ t('audit.loadOlder') }}
          </GTButton>
        </div>
      </template>

      <p v-else-if="!loading" class="text-tertiary text-sm py-12 text-center m-0">
        {{ actorQuery ? t('audit.noMatches') : t('audit.empty') }}
      </p>
    </template>
  </section>
</template>
