<script setup lang="ts">
  // Ét font-slot (Font 1/overskrift eller Font 2/brødtekst — to-slot-
  // revisionen 2026-08-04, forlæg redesign-brand-assets.html). Bibliotek-
  // eller upload-tilstand pr. slot + kuraterede system-fallbacks (nøgler,
  // aldrig fritekst) + kæde-feedback der spejler serverens fontFamilyChain.
  import { FONT_LICENCE_VERSION } from '~~/lib/legal'
  import type { FontSlot } from '~~/server/lib/tokens'

  const props = defineProps<{
    slotKey: 'heading' | 'body'
    projectId: string
    canEdit: boolean
    /** Resterende fil-budget UDOVER dette slots egne filer (Allan-loft: 4 i alt). */
    remainingBudget: number
  }>()
  const model = defineModel<FontSlot | null>({ required: true })

  const { t } = useI18n()

  // Spejler server-konstanterne (CURATED_FONT_WEIGHTS/FALLBACK_STACKS) —
  // bevidst lokale kopier: server/lib/tokens.ts er zod-tung og skal ikke i
  // klient-bundlet. Kontrakten pinnes af server-tests; divergens fanges af
  // schema-validering ved draft-save.
  const CURATED_WEIGHTS: Record<string, number[]> = {
    'IBM Plex Sans': [400, 500, 600, 700],
    Inter: [400, 500, 600, 700, 800],
    'Source Sans 3': [400, 500, 600, 700, 800],
    'Work Sans': [400, 500, 600, 700, 800],
    Manrope: [400, 500, 600, 700, 800],
    'Public Sans': [400, 500, 600, 700, 800],
  }
  const WEIGHT_LABELS: Record<number, string> = {
    400: '400 Regular',
    500: '500 Medium',
    600: '600 Semibold',
    700: '700 Bold',
    800: '800 Extrabold',
  }
  const FALLBACK_KEYS = [
    'system-grotesk',
    'neutral-grotesk',
    'humanist',
    'serif-classic',
    'serif-typewriter',
    'monospace',
  ] as const
  const FALLBACK_CSS: Record<string, { fonts: string[]; generic: string }> = {
    'system-grotesk': { fonts: ["'Segoe UI'", 'Roboto'], generic: 'sans-serif' },
    'neutral-grotesk': { fonts: ["'Helvetica Neue'", 'Arial'], generic: 'sans-serif' },
    humanist: { fonts: ['Verdana', 'Geneva'], generic: 'sans-serif' },
    'serif-classic': { fonts: ['Georgia', 'Cambria'], generic: 'serif' },
    'serif-typewriter': { fonts: ["'Times New Roman'", 'Times'], generic: 'serif' },
    monospace: { fonts: ["'SF Mono'", 'Consolas'], generic: 'monospace' },
  }

  const mode = ref<'curated' | 'custom'>(model.value?.source ?? 'curated')
  const curatedFamily = ref(
    model.value?.source === 'curated' ? model.value.family : 'IBM Plex Sans',
  )
  const curatedWeights = ref<number[]>(
    model.value?.source === 'curated' ? [...model.value.weights] : [400],
  )
  const customFamily = ref(model.value?.source === 'custom' ? model.value.family : '')
  const customFiles = ref<Record<string, string>>(
    model.value?.source === 'custom' ? { ...model.value.files } : {},
  )
  const customWeight = ref('400')
  const licenseAccepted = ref(model.value?.source === 'custom')
  // Tidspunktet for selve afkrydsningen er en del af beviset (§8c-mønstret) —
  // ikke upload-tidspunktet, som kan ligge minutter senere.
  const licenseAcceptedAt = ref<string | null>(null)
  watch(licenseAccepted, (accepted) => {
    licenseAcceptedAt.value = accepted ? new Date().toISOString() : null
  })
  const fallback1 = ref<string>(model.value?.fallbacks[0] ?? 'system-grotesk')
  const fallback2 = ref<string>(model.value?.fallbacks[1] ?? '')
  const error = ref<string | null>(null)
  const uploading = ref(false)
  const fileInput = ref<HTMLInputElement | null>(null)

  const availableWeights = computed(() => CURATED_WEIGHTS[curatedFamily.value] ?? [400])
  const ownFileCount = computed(() =>
    mode.value === 'custom' ? Object.keys(customFiles.value).length : curatedWeights.value.length,
  )
  const budgetLeft = computed(() => props.remainingBudget)
  const budgetFull = computed(() => budgetLeft.value <= 0)

  function fallbacks(): string[] {
    return fallback2.value ? [fallback1.value, fallback2.value] : [fallback1.value]
  }

  /** Spejl af serverens fontFamilyChain — preview og publiceret CSS kan ikke divergere. */
  const chain = computed(() => {
    const family = mode.value === 'custom' ? customFamily.value.trim() : curatedFamily.value
    if (!family) return null
    const parts = [`'${family.replace(/'/g, '')}'`]
    for (const key of fallbacks()) parts.push(...FALLBACK_CSS[key].fonts)
    const last = fallbacks()[fallbacks().length - 1]
    parts.push(FALLBACK_CSS[last].generic)
    return parts.join(', ')
  })

  function emitCurated() {
    if (curatedWeights.value.length === 0) return
    model.value = {
      source: 'curated',
      family: curatedFamily.value,
      weights: [...curatedWeights.value].sort((a, b) => a - b),
      fallbacks: fallbacks(),
    } as FontSlot
  }

  function emitCustom() {
    const weights = Object.keys(customFiles.value)
      .map(Number)
      .sort((a, b) => a - b)
    if (weights.length === 0) {
      model.value = null
      return
    }
    model.value = {
      source: 'custom',
      family: customFamily.value.trim(),
      weights,
      files: { ...customFiles.value },
      fallbacks: fallbacks(),
    } as FontSlot
  }

  function toggleWeight(w: number) {
    const set = new Set(curatedWeights.value)
    if (set.has(w)) {
      if (set.size === 1) return
      set.delete(w)
    } else {
      if (budgetFull.value) return
      set.add(w)
    }
    curatedWeights.value = [...set]
    emitCurated()
  }

  watch([curatedFamily], () => {
    curatedWeights.value = curatedWeights.value.filter((w) => availableWeights.value.includes(w))
    if (curatedWeights.value.length === 0) curatedWeights.value = [400]
    if (mode.value === 'curated') emitCurated()
    void loadCuratedPreview()
  })

  watch([fallback1, fallback2], () => {
    if (mode.value === 'curated') emitCurated()
    else if (Object.keys(customFiles.value).length > 0) emitCustom()
  })

  async function uploadFont(file: File) {
    if (!customFamily.value.trim()) {
      error.value = t('brandAssets.errFamilyFirst')
      return
    }
    if (!licenseAccepted.value || !licenseAcceptedAt.value) {
      error.value = t('brandAssets.errLicenceRequired')
      return
    }
    error.value = null
    uploading.value = true
    try {
      const res = await $fetch<{ file: string; weight: number }>(
        `/api/projects/${props.projectId}/assets/font`,
        {
          method: 'POST',
          body: file,
          query: {
            slot: props.slotKey,
            family: customFamily.value.trim(),
            weight: Number(customWeight.value),
            licenceVersion: FONT_LICENCE_VERSION,
            licenceAcceptedAt: licenseAcceptedAt.value,
          },
        },
      )
      customFiles.value = { ...customFiles.value, [String(res.weight)]: res.file }
      emitCustom()
      void previewCustomFont(file, res.weight)
    } catch (err) {
      const code = (err as { data?: { data?: { code?: string } } }).data?.data?.code
      error.value =
        code === 'too_large'
          ? t('brandAssets.errTooLarge')
          : code === 'licence_attestation_required' || code === 'licence_version_mismatch'
            ? t('brandAssets.errLicenceRequired')
            : t('brandAssets.errFontFormat')
    } finally {
      uploading.value = false
    }
  }

  function removeWeight(w: string) {
    customFiles.value = Object.fromEntries(
      Object.entries(customFiles.value).filter(([weight]) => weight !== w),
    )
    emitCustom()
  }

  function switchMode(next: 'curated' | 'custom') {
    mode.value = next
    if (next === 'curated') emitCurated()
    else if (Object.keys(customFiles.value).length > 0) emitCustom()
    else model.value = null
  }

  // Ægte-font-preview: kuraterede via lazy @fontsource-css (allerede deps,
  // ingen eksterne kald), custom via FontFace-API'et fra upload-bytes.
  const curatedCss = import.meta.glob('/node_modules/@fontsource/*/{400,500,600,700,800}.css')
  const FONT_PKG: Record<string, string> = {
    'IBM Plex Sans': 'ibm-plex-sans',
    Inter: 'inter',
    'Source Sans 3': 'source-sans-3',
    'Work Sans': 'work-sans',
    Manrope: 'manrope',
    'Public Sans': 'public-sans',
  }

  async function loadCuratedPreview() {
    const pkg = FONT_PKG[curatedFamily.value]
    if (!pkg) return
    await Promise.all(
      availableWeights.value.map((w) =>
        curatedCss[`/node_modules/@fontsource/${pkg}/${w}.css`]?.(),
      ),
    )
  }

  async function previewCustomFont(file: File, weight: number) {
    try {
      const face = new FontFace(customFamily.value.trim(), await file.arrayBuffer(), {
        weight: String(weight),
      })
      await face.load()
      document.fonts.add(face)
    } catch {
      // Preview-fejl er kosmetisk — uploaden er allerede lykkedes.
    }
  }

  onMounted(() => {
    void loadCuratedPreview()
  })

  defineExpose({ ownFileCount })
</script>

<template>
  <GTCard :title="t(`brandAssets.slot.${slotKey}.title`)">
    <p class="text-tertiary text-sm mt-0 mb-4">{{ t(`brandAssets.slot.${slotKey}.role`) }}</p>

    <div class="brand-font-mode" role="tablist">
      <button type="button" :class="{ on: mode === 'curated' }" @click="switchMode('curated')">
        {{ t('brandAssets.modeCurated') }}
      </button>
      <button type="button" :class="{ on: mode === 'custom' }" @click="switchMode('custom')">
        {{ t('brandAssets.modeCustom') }}
      </button>
    </div>

    <template v-if="mode === 'curated'">
      <GTSelect
        v-model="curatedFamily"
        :label="t('brandAssets.familyLabel')"
        :options="Object.keys(CURATED_WEIGHTS).map((f) => ({ value: f, label: f }))"
        :disabled="!canEdit"
      />
      <div class="mt-4">
        <p class="text-sm font-medium mb-2 mt-0">
          {{ t('brandAssets.weightsLabel') }}
          <span class="text-tertiary font-normal">{{ t('brandAssets.weightsHint') }}</span>
        </p>
        <div class="brand-weight-chips">
          <label
            v-for="w in availableWeights"
            :key="w"
            class="brand-weight-chip"
            :class="{ on: curatedWeights.includes(w) }"
          >
            <input
              type="checkbox"
              :checked="curatedWeights.includes(w)"
              :disabled="!canEdit || (!curatedWeights.includes(w) && budgetFull)"
              @change="toggleWeight(w)"
            />
            {{ WEIGHT_LABELS[w] }}
          </label>
        </div>
        <p v-if="budgetFull" class="text-tertiary text-xs mt-2 mb-0">
          {{ t('brandAssets.budgetFull') }}
        </p>
      </div>
    </template>

    <template v-else>
      <GTInput
        v-model="customFamily"
        :label="t('brandAssets.customFamilyLabel')"
        :disabled="!canEdit"
        class="mb-3"
      />
      <!-- [jura]-låst form (§5a, 69ec051): selve ERKLÆRINGEN står alene i
           labelen — hjælpetekst og link ligger UDENFOR, fordi en lang
           afkrydsningstekst ikke bliver læst og dermed svækker erklæringen.
           🔴 De to led i license-strengen ("ret til at bruge" OG "lade
           Grundtone distribuere den til brugerne") må ALDRIG slås sammen
           eller forkortes: første led alene er præcis hvad en desktop-licens
           giver, så det er ANDET led der bærer hele erklæringen. -->
      <div class="brand-license mb-1">
        <input
          :id="`font-license-${slotKey}`"
          v-model="licenseAccepted"
          type="checkbox"
          :disabled="!canEdit"
        />
        <label :for="`font-license-${slotKey}`" class="text-sm">
          {{ t('brandAssets.license') }}
        </label>
      </div>
      <p class="text-tertiary text-xs mt-0 mb-3">
        {{ t('brandAssets.licenseHelp') }}
        <NuxtLink to="/legal" class="text-primary">{{ t('brandAssets.licenseMore') }}</NuxtLink>
      </p>
      <template v-if="!budgetFull">
        <GTSelect
          v-model="customWeight"
          :label="t('brandAssets.weightForFile')"
          :options="
            Object.keys(WEIGHT_LABELS).map((w) => ({ value: w, label: WEIGHT_LABELS[Number(w)] }))
          "
          :disabled="!canEdit || !licenseAccepted"
          class="mb-2"
        />
        <button
          v-if="canEdit"
          type="button"
          class="brand-dropzone"
          :disabled="uploading || !licenseAccepted"
          @click="fileInput?.click()"
          @dragover.prevent
          @drop.prevent="
            (e: DragEvent) => e.dataTransfer?.files[0] && uploadFont(e.dataTransfer.files[0])
          "
        >
          {{ uploading ? t('brandAssets.uploading') : t('brandAssets.fontDropzone') }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".woff2,font/woff2"
          class="visually-hidden"
          @change="
            (e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0]
              if (f) uploadFont(f)
            }
          "
        />
        <p class="text-tertiary text-xs mt-2 mb-0">{{ t('brandAssets.fontRules') }}</p>
      </template>
      <p v-else class="text-tertiary text-sm">{{ t('brandAssets.budgetFull') }}</p>
      <GTAlert v-if="error" variant="error" :heading="error" class="mt-2" />
      <ul v-if="Object.keys(customFiles).length > 0" class="list-reset mt-3 flex flex-col gap-1">
        <li
          v-for="(file, w) in customFiles"
          :key="w"
          class="flex items-center justify-between text-sm"
        >
          <span
            >{{ WEIGHT_LABELS[Number(w)] }} · <code>{{ file }}</code></span
          >
          <GTButton v-if="canEdit" variant="outlined" size="sm" @click="removeWeight(String(w))">
            {{ t('brandAssets.remove') }}
          </GTButton>
        </li>
      </ul>
    </template>

    <div class="brand-fallback">
      <p class="brand-fallback__label">{{ t('brandAssets.fallbackTitle') }}</p>
      <p class="brand-fallback__expl">{{ t(`brandAssets.slot.${slotKey}.fallbackExpl`) }}</p>
      <div class="brand-fallback__row">
        <GTSelect
          v-model="fallback1"
          :label="t('brandAssets.fallback1')"
          :options="FALLBACK_KEYS.map((k) => ({ value: k, label: t(`brandAssets.stacks.${k}`) }))"
          :disabled="!canEdit"
        />
        <GTSelect
          v-model="fallback2"
          :label="t('brandAssets.fallback2')"
          :options="[
            { value: '', label: t('brandAssets.fallbackNone') },
            ...FALLBACK_KEYS.filter((k) => k !== fallback1).map((k) => ({
              value: k,
              label: t(`brandAssets.stacks.${k}`),
            })),
          ]"
          :disabled="!canEdit"
        />
      </div>
      <div v-if="chain" class="brand-fallback__chain"><b>font-family:</b> {{ chain }};</div>
    </div>
  </GTCard>
</template>
