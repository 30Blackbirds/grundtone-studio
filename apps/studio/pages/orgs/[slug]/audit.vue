<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'
  import { groupByDay } from '~~/utils/audit-export'
  import {
    actorLabel,
    auditObject,
    dayLabel,
    fullTimestamp,
    initials,
    periodStart,
    timeOfDay,
    type PeriodFilter,
  } from '~~/utils/audit-view'

  definePageMeta({ layout: 'app' })

  const { t, locale } = useI18n()
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
    'config.draft_saved',
    'project.member.invited',
    'project.member.added',
    'project.member.removed',
    'audit.exported',
  ] as const

  const PERIODS: PeriodFilter[] = ['all', '7d', '30d', '90d']

  // Default "all": on a compliance surface a default period would quietly hide
  // older events ([designer] 2026-09-17). "Load older" handles volume.
  const actionFilter = ref<(typeof ACTION_FILTERS)[number]>('all')
  const actorFilter = ref('all')
  const periodFilter = ref<PeriodFilter>('all')
  const search = ref('')
  const debouncedSearch = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  watch(search, (value) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => (debouncedSearch.value = value.trim()), 300)
  })
  onUnmounted(() => clearTimeout(searchTimer))

  // Members for the actor filter and for showing names instead of emails.
  const { data: members } = await useAsyncData(
    () => `audit-members-${activeOrg.value?.id ?? 'none'}`,
    async () => {
      if (!activeOrg.value?.id) return []
      const res = await organization.listMembers({
        query: { organizationId: activeOrg.value.id },
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return res.data?.members ?? []
    },
    { default: () => [], watch: [activeOrg] },
  )
  const nameByUserId = computed(
    () => new Map(members.value.map((m) => [m.userId, m.user?.name || null])),
  )
  const actorOptions = computed(() => [
    { value: 'all', label: t('audit.allActors') },
    ...members.value.map((m) => ({ value: m.userId, label: m.user?.name || m.user?.email || '' })),
  ])

  // Cursor pagination, accumulated by "load older"; any filter change resets it.
  // Search runs server-side over the whole history (UX-audit finding 13).
  const rows = ref<AuditRow[]>([])
  const cursor = ref<{ before: string; beforeId: string } | null>(null)
  const hasMore = ref(false)
  const loading = ref(false)

  // Action labels are translated here, so the actions whose label matches the
  // search are sent along and matched by key on the server.
  function actionsMatchingLabel(q: string): string[] {
    const needle = q.toLowerCase()
    return ACTION_FILTERS.filter(
      (a) => a !== 'all' && t(auditActionKey(a)).toLowerCase().includes(needle),
    )
  }

  // The same filters go to the list and to the export.
  function filterParams(): URLSearchParams {
    const qs = new URLSearchParams()
    if (actionFilter.value !== 'all') qs.set('action', actionFilter.value)
    if (actorFilter.value !== 'all') qs.set('actor', actorFilter.value)
    const after = periodStart(periodFilter.value, new Date())
    if (after) qs.set('after', after.toISOString())
    if (debouncedSearch.value) {
      qs.set('q', debouncedSearch.value)
      const labelMatches = actionsMatchingLabel(debouncedSearch.value)
      if (labelMatches.length) qs.set('qActions', labelMatches.join(','))
    }
    return qs
  }

  async function loadPage(reset: boolean) {
    if (!activeOrg.value?.id || !canManageOrgMembers.value) return
    loading.value = true
    try {
      const qs = filterParams()
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

  watch(
    [activeOrg, actionFilter, actorFilter, periodFilter, debouncedSearch, canManageOrgMembers],
    () => loadPage(true),
    { immediate: true },
  )

  const now = new Date()
  const dayGroups = computed(() => groupByDay(rows.value))
  const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  function actorOf(row: AuditRow): string {
    const name = row.actorUserId ? nameByUserId.value.get(row.actorUserId) : null
    return actorLabel({ actorName: name, actorEmail: row.actorEmail }) ?? t('audit.systemActor')
  }

  // Server-side export of the WHOLE filtered history, not the loaded rows.
  // The server refuses (413) instead of truncating above its row cap, and
  // records the export in the audit log.
  // useToast is Nuxt's auto-import (@grundtone/vue/src/composables), the same
  // module instance GTToastContainer reads. An explicit import from
  // '@grundtone/vue' resolves to dist/ and its toasts never render.
  const toast = useToast()
  const exporting = ref(false)
  async function exportCsv() {
    if (!activeOrg.value?.id) return
    exporting.value = true
    try {
      const qs = filterParams()
      const res = await fetch(
        `/api/orgs/${activeOrg.value.id}/audit/export${qs.toString() ? '?' + qs.toString() : ''}`,
        { credentials: 'include' },
      )
      if (!res.ok) {
        toast.error(res.status === 413 ? t('audit.exportTooLarge') : t('audit.exportFailed'))
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-${activeOrg.value.slug}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      exporting.value = false
    }
  }
</script>

<template>
  <section class="p-6 max-w-5xl mx-auto flex flex-col gap-4">
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <header>
      <h1 class="m-0 font-heading">{{ t('audit.title') }}</h1>
      <!-- The time zone note is a standing legal statement: always visible. -->
      <p class="text-tertiary m-0 mt-1">
        {{ t('audit.intro') }} · {{ t('audit.timezoneNote', { tz: viewerTimeZone }) }}
      </p>
    </header>

    <GTAlert v-if="!canManageOrgMembers" variant="info" :heading="t('audit.restrictedHeading')">
      {{ t('audit.restrictedBody') }}
    </GTAlert>

    <template v-else>
      <div class="audit-toolbar">
        <GTInput
          v-model="search"
          class="audit-toolbar__search"
          type="search"
          :label="t('audit.search')"
          :placeholder="t('audit.searchPlaceholder')"
          size="sm"
        />
        <GTSelect v-model="actorFilter" :label="t('audit.filterByActor')" :options="actorOptions" />
        <GTSelect
          v-model="actionFilter"
          :label="t('audit.filterByAction')"
          :options="ACTION_FILTERS.map((a) => ({ value: a, label: t(auditActionKey(a)) }))"
        />
        <GTSelect
          v-model="periodFilter"
          :label="t('audit.filterByPeriod')"
          :options="PERIODS.map((p) => ({ value: p, label: t(`audit.period.${p}`) }))"
        />
        <div class="audit-toolbar__actions">
          <!-- Kept although filters reload by themselves: "has anything happened
               since I opened this page" is the question this screen answers. -->
          <GTButton variant="outlined" size="sm" :loading="loading" @click="loadPage(true)">
            {{ t('audit.refresh') }}
          </GTButton>
          <GTButton
            v-if="rows.length"
            variant="outlined"
            size="sm"
            :loading="exporting"
            @click="exportCsv"
          >
            {{ t('audit.exportCsv') }}
          </GTButton>
        </div>
      </div>

      <template v-if="dayGroups.length">
        <div class="audit-table-wrap bg-surface-raised border rounded-lg">
          <table class="audit-table">
            <thead>
              <tr>
                <th scope="col">{{ t('audit.columns.actor') }}</th>
                <th scope="col">{{ t('audit.columns.action') }}</th>
                <th scope="col">{{ t('audit.columns.object') }}</th>
                <th scope="col" class="audit-table__time">{{ t('audit.columns.time') }}</th>
              </tr>
            </thead>
            <tbody v-for="group in dayGroups" :key="group.day">
              <tr class="audit-table__day">
                <th colspan="4" scope="colgroup">{{ dayLabel(group.day, now, locale) }}</th>
              </tr>
              <tr v-for="row in group.rows" :key="row.id">
                <td :data-label="t('audit.columns.actor')">
                  <span class="audit-actor">
                    <span class="audit-actor__avatar" aria-hidden="true">
                      {{ initials(actorOf(row)) }}
                    </span>
                    <span class="audit-actor__name">{{ actorOf(row) }}</span>
                  </span>
                </td>
                <td :data-label="t('audit.columns.action')" class="text-secondary">
                  {{ t(auditActionKey(row.action)) }}
                </td>
                <td :data-label="t('audit.columns.object')">
                  <!-- One mono line "target: before → after"; the IP is always
                       visible on every row (compliance, [designer]). -->
                  <code class="audit-object">{{ auditObject(row) }}</code>
                  <span v-if="row.ipAddress" class="audit-ip">{{ row.ipAddress }}</span>
                </td>
                <td
                  :data-label="t('audit.columns.time')"
                  class="audit-table__time text-tertiary"
                  :title="fullTimestamp(row.createdAt, locale)"
                >
                  {{ timeOfDay(row.createdAt, locale) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="hasMore" class="text-center">
          <GTButton variant="secondary" size="sm" :loading="loading" @click="loadPage(false)">
            {{ t('audit.loadOlder') }}
          </GTButton>
        </div>
      </template>

      <p v-else-if="!loading" class="text-tertiary text-sm py-12 text-center m-0">
        {{ debouncedSearch ? t('audit.noMatches') : t('audit.empty') }}
      </p>
    </template>
  </section>
</template>
