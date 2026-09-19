<script setup lang="ts">
  import type { ExportReport } from '@grundtone-studio/dtcg'

  // DTCG 2025.10 export (riff KH-1005, E8). Available to every role that can
  // see the project and on every plan: the design tokens are the customer's,
  // and taking them elsewhere must never depend on a subscription.
  const props = defineProps<{
    projectId: string
    hasDraft: boolean
    hasActive: boolean
    // Changes whenever the saved draft or the active version changes, so the
    // report is fetched again instead of describing tokens that are gone.
    revision: string
  }>()
  const { t, te } = useI18n()

  type Source = 'draft' | 'active'
  type Part = 'base' | 'dark' | 'resolver'

  interface ReportResponse {
    source: Source
    version: number
    files: Record<Part, string | null>
    report: ExportReport
  }

  const source = ref<Source>(props.hasActive ? 'active' : 'draft')
  const sourceOptions = computed(() =>
    (['active', 'draft'] as const)
      .filter((s) => (s === 'active' ? props.hasActive : props.hasDraft))
      .map((s) => ({ value: s, label: t(`dtcgExport.source.${s}`) })),
  )

  const url = (part: Part | 'report') =>
    `/api/projects/${props.projectId}/tokens/export?source=${source.value}&part=${part}`

  const { data, error, pending } = await useAsyncData<ReportResponse | null>(
    () => `dtcg-report-${props.projectId}-${source.value}`,
    () =>
      props.hasDraft || props.hasActive
        ? $fetch<ReportResponse>(url('report'), { headers: useRequestHeaders(['cookie']) })
        : Promise.resolve(null),
    { watch: [source, () => props.revision] },
  )

  const parts = computed(() =>
    data.value
      ? (['base', 'dark', 'resolver'] as const).flatMap((part) => {
          const name = data.value!.files[part]
          return name ? [{ part, name }] : []
        })
      : [],
  )

  // Same-origin link with the download attribute: the session cookie goes
  // along and the server's Content-Disposition names the file.
  function download(part: Part, name: string) {
    const a = document.createElement('a')
    a.href = url(part)
    a.download = name
    a.click()
  }

  const reason = (entry: { code: string; reason: string }) =>
    te(`dtcgExport.codes.${entry.code}`) ? t(`dtcgExport.codes.${entry.code}`) : entry.reason
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h2 class="m-0">{{ t('dtcgExport.title') }}</h2>
      <p class="text-tertiary mt-1 mb-0 text-sm">{{ t('dtcgExport.intro') }}</p>
    </div>

    <p v-if="!hasDraft && !hasActive" class="text-tertiary m-0">{{ t('dtcgExport.empty') }}</p>

    <template v-else>
      <GTSelect
        v-if="sourceOptions.length > 1"
        v-model="source"
        :label="t('dtcgExport.sourceLabel')"
        :options="sourceOptions"
        class="dtcg-export__source"
      />

      <GTAlert v-if="error" variant="error" :heading="t('dtcgExport.failed')" />

      <template v-else-if="data">
        <p class="m-0 text-sm">
          {{
            t('dtcgExport.summary', {
              exported: data.report.exported,
              total: data.report.total,
              version: data.version,
            })
          }}
        </p>

        <div class="flex gap-3 flex-wrap">
          <GTButton
            v-for="file in parts"
            :key="file.part"
            :variant="file.part === 'base' ? 'primary' : 'secondary'"
            :disabled="pending"
            @click="download(file.part, file.name)"
          >
            {{ t(`dtcgExport.download.${file.part}`) }}
            <span class="font-mono text-xs ml-2">{{ file.name }}</span>
          </GTButton>
        </div>

        <GTAlert
          v-if="data.report.omitted.length"
          variant="warning"
          :heading="t('dtcgExport.omittedHeading', { n: data.report.omitted.length })"
        >
          <ul class="list-reset flex flex-col gap-1 m-0">
            <li v-for="entry in data.report.omitted" :key="entry.path" class="text-sm">
              <code>{{ entry.path }}</code>
              <span class="text-tertiary"> = {{ entry.value }}</span> — {{ reason(entry) }}
            </li>
          </ul>
        </GTAlert>

        <GTDetails
          v-if="data.report.converted.length"
          :summary="t('dtcgExport.convertedSummary', { n: data.report.converted.length })"
          variant="subtle"
        >
          <ul class="list-reset flex flex-col gap-1 mt-2">
            <li v-for="entry in data.report.converted" :key="entry.target" class="text-sm">
              <code>{{ entry.path }}</code>
              <span class="text-tertiary"> = {{ entry.value }}</span> — {{ reason(entry) }}
            </li>
          </ul>
        </GTDetails>
      </template>
    </template>
  </div>
</template>

<style scoped>
  .dtcg-export__source {
    max-width: 16rem;
  }
</style>
