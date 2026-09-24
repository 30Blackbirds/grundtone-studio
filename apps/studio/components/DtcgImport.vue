<script setup lang="ts">
  import type { ImportReport } from '@grundtone-studio/dtcg'

  // DTCG 2025.10 import (riff KH-1044 I11, KH-1182). Three steps, in this order:
  // upload → report → save as draft. The middle step is the point: the person
  // sees what WOULD happen, including what would be overwritten, before
  // anything is written.
  //
  // 🔴 EVERY STRING FROM THE FILE IS RENDERED AS TEXT. Paths, values and reasons
  // come from a document a stranger may have produced, so they go through
  // interpolation only — never v-html, and never a template that builds markup
  // from them. That is I11's own requirement and the reason this component has
  // no HTML-bearing branch at all.
  const props = defineProps<{ projectId: string; canEdit: boolean }>()
  const emit = defineEmits<{ saved: [version: number] }>()

  const { t } = useI18n()

  interface ImportResponse {
    report: ImportReport
    tokens: Record<string, unknown>
    version?: number
    saved: boolean
  }

  type Phase = 'pick' | 'report' | 'done'

  const phase = ref<Phase>('pick')
  const base = ref<{ name: string; json: unknown } | null>(null)
  const dark = ref<{ name: string; json: unknown } | null>(null)
  const report = ref<ImportReport | null>(null)
  const savedVersion = ref<number | null>(null)
  const busy = ref(false)
  const error = ref('')

  // The file is parsed in the browser so a malformed file is caught before a
  // request is made, and the person is told which file and why.
  async function take(which: 'base' | 'dark', files: File[]) {
    error.value = ''
    const file = files[0]
    const slot = which === 'base' ? base : dark
    if (!file) {
      slot.value = null
      return
    }
    try {
      slot.value = { name: file.name, json: JSON.parse(await file.text()) }
    } catch {
      slot.value = null
      error.value = t('dtcgImport.notJson', { file: file.name })
    }
  }

  async function send(dryRun: boolean) {
    if (!base.value) return
    busy.value = true
    error.value = ''
    try {
      const res = await $fetch<ImportResponse>(`/api/projects/${props.projectId}/tokens/import`, {
        method: 'POST',
        body: { base: base.value.json, dark: dark.value?.json, dryRun },
      })
      report.value = res.report
      if (res.saved) {
        savedVersion.value = res.version ?? null
        phase.value = 'done'
        emit('saved', res.version ?? 0)
      } else {
        phase.value = 'report'
      }
    } catch (e) {
      // The server's own statusMessage names the file and the reason; it is
      // shown as text, like everything else from the document.
      error.value = (e as { statusMessage?: string })?.statusMessage ?? t('dtcgImport.failed')
    } finally {
      busy.value = false
    }
  }

  function startOver() {
    phase.value = 'pick'
    base.value = null
    dark.value = null
    report.value = null
    savedVersion.value = null
    error.value = ''
  }

  const prefixes = computed(() =>
    Object.entries(report.value?.notMappedByPrefix ?? {}).sort((a, b) => b[1] - a[1]),
  )
  const vendors = computed(() => Object.entries(report.value?.droppedExtensions ?? {}))
</script>

<template>
  <div class="flex flex-col gap-6">
    <p class="text-tertiary m-0 text-sm">{{ t('dtcgImport.intro') }}</p>

    <GTAlert v-if="error" variant="error" :heading="error" />

    <template v-if="phase === 'pick'">
      <GTFileUpload
        :label="t('dtcgImport.baseLabel')"
        :help-text="t('dtcgImport.baseHelp')"
        accept="application/json,.json"
        @change="take('base', $event)"
      />
      <GTFileUpload
        :label="t('dtcgImport.darkLabel')"
        :help-text="t('dtcgImport.darkHelp')"
        accept="application/json,.json"
        @change="take('dark', $event)"
      />
      <div>
        <GTButton :disabled="!base || busy" :loading="busy" @click="send(true)">
          {{ t('dtcgImport.analyse') }}
        </GTButton>
      </div>
    </template>

    <template v-else-if="phase === 'report' && report">
      <!-- The denominator first: the four categories sum to the token count, so
           a report cannot quietly leave tokens out. -->
      <p class="m-0">
        {{
          t('dtcgImport.summary', {
            total: report.total,
            mapped: report.mapped.length,
            notMapped: report.notMapped.length,
            invalid: report.invalid.length,
          })
        }}
      </p>

      <GTAlert
        v-if="report.overwritten > 0"
        variant="warning"
        :heading="t('dtcgImport.overwrites', { n: report.overwritten })"
      />

      <GTDetails
        v-if="report.invalid.length"
        :summary="t('dtcgImport.invalidSummary', { n: report.invalid.length })"
        variant="subtle"
      >
        <ul class="list-reset flex flex-col gap-1 mt-2">
          <li v-for="entry in report.invalid" :key="entry.path" class="text-sm">
            <code>{{ entry.path }}</code>
            <span class="text-tertiary"> = {{ entry.value }}</span> — {{ entry.reason }}
          </li>
        </ul>
      </GTDetails>

      <GTDetails
        v-if="prefixes.length"
        :summary="t('dtcgImport.notMappedSummary', { n: report.notMapped.length })"
        variant="subtle"
      >
        <!-- Counts per top-level path, not values (O1). -->
        <ul class="list-reset flex flex-col gap-1 mt-2">
          <li v-for="[prefix, count] in prefixes" :key="prefix" class="text-sm">
            <code>{{ prefix }}</code>
            <span class="text-tertiary">
              — {{ t('dtcgImport.tokenCount', { n: count }, count) }}</span
            >
          </li>
        </ul>
      </GTDetails>

      <GTDetails
        v-if="report.converted.length"
        :summary="t('dtcgImport.convertedSummary', { n: report.converted.length })"
        variant="subtle"
      >
        <ul class="list-reset flex flex-col gap-1 mt-2">
          <li v-for="entry in report.converted" :key="entry.path" class="text-sm">
            <code>{{ entry.path }}</code> — {{ entry.reason }}
          </li>
        </ul>
      </GTDetails>

      <!-- What the file carried that Studio does not store, named per vendor so
           the loss is visible rather than silent (I9). -->
      <GTAlert v-if="vendors.length" variant="info" :heading="t('dtcgImport.droppedHeading')">
        <ul class="list-reset flex flex-col gap-1 m-0">
          <li v-for="[vendor, paths] in vendors" :key="vendor" class="text-sm">
            <code>{{ vendor }}</code>
            <span class="text-tertiary"> — {{ paths.join(', ') }}</span>
          </li>
        </ul>
      </GTAlert>

      <div class="flex gap-3">
        <GTButton v-if="canEdit" :loading="busy" @click="send(false)">
          {{ t('dtcgImport.saveDraft') }}
        </GTButton>
        <GTButton variant="secondary" :disabled="busy" @click="startOver">
          {{ t('dtcgImport.chooseOther') }}
        </GTButton>
      </div>
      <p v-if="!canEdit" class="text-tertiary m-0 text-sm">{{ t('dtcgImport.needsEditor') }}</p>
    </template>

    <template v-else-if="phase === 'done'">
      <GTAlert
        variant="success"
        :heading="t('dtcgImport.savedHeading', { version: savedVersion ?? 0 })"
      >
        <p class="m-0">{{ t('dtcgImport.savedBody') }}</p>
      </GTAlert>
      <div>
        <GTButton variant="secondary" @click="startOver">
          {{ t('dtcgImport.importAnother') }}
        </GTButton>
      </div>
    </template>
  </div>
</template>
