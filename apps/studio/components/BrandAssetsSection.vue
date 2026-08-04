<script setup lang="ts">
  // Brand-assets-sektionen i Tokens-fanen (forlæg redesign-brand-assets.html,
  // designer-låst 2026-08-03). Bevidst en SEKTION og ikke egen fane: assets
  // publiceres MED farve-tokens i samme kladde/publicér-cyklus (sidens header
  // er den fælles linje). Upload-endpoints skriver draft-blobs og returnerer
  // referencer; denne komponent gemmer referencerne i tokens-JSON'en (schemaet
  // fra slice 1 håndhæver formen ved draft-save).
  import type { Tokens } from '~~/server/lib/tokens'

  const props = defineProps<{ projectId: string; canEdit: boolean }>()
  const tokens = defineModel<Tokens>({ required: true })

  const { t } = useI18n()

  // Spejler CURATED_FONTS/FONT_WEIGHTS fra server-schemaet — bevidst som
  // lokale konstanter: server/lib/tokens.ts er zod-tung og skal ikke ind i
  // klient-bundlet (samme afvejning som previewTokens på projekt-siden).
  const CURATED = [
    'IBM Plex Sans',
    'Inter',
    'Source Sans 3',
    'Work Sans',
    'Manrope',
    'Public Sans',
  ] as const
  const WEIGHTS = [400, 500, 600, 700] as const
  const WEIGHT_LABELS: Record<number, string> = {
    400: '400 Regular',
    500: '500 Medium',
    600: '600 Semibold',
    700: '700 Bold',
  }

  // ── Logo ────────────────────────────────────────────────────────────────
  const logo = computed(() => tokens.value.assets?.logo ?? null)
  const logoError = ref<string | null>(null)
  const logoUploading = ref(false)
  // Draft-blobs serveres ikke offentligt (/k = current/), så previewen viser
  // den netop uploadede fil via objectURL; efter reload vises reference-navnet.
  const logoPreviewUrl = ref<string | null>(null)
  const logoInput = ref<HTMLInputElement | null>(null)

  async function uploadLogo(file: File) {
    logoError.value = null
    logoUploading.value = true
    try {
      const res = await $fetch<{ file: string; type: 'svg' | 'png' }>(
        `/api/projects/${props.projectId}/assets/logo`,
        { method: 'POST', body: file },
      )
      tokens.value = { ...tokens.value, assets: { logo: res } }
      if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
      logoPreviewUrl.value = URL.createObjectURL(file)
    } catch (err) {
      const code = (err as { data?: { data?: { code?: string } } }).data?.data?.code
      logoError.value =
        code === 'too_large' ? t('brandAssets.errTooLarge') : t('brandAssets.errLogoFormat')
    } finally {
      logoUploading.value = false
    }
  }

  function removeLogo() {
    const next = { ...tokens.value }
    delete next.assets
    tokens.value = next
    if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
    logoPreviewUrl.value = null
  }

  // ── Skrifttype ──────────────────────────────────────────────────────────
  type WebFont = NonNullable<NonNullable<Tokens['typography']>['webFont']>
  const webFont = computed(() => tokens.value.typography?.webFont ?? null)
  const fontMode = ref<'curated' | 'custom'>(webFont.value?.source ?? 'curated')

  const curatedFamily = ref<string>(
    webFont.value?.source === 'curated' ? webFont.value.family : 'IBM Plex Sans',
  )
  const curatedWeights = ref<number[]>(
    webFont.value?.source === 'curated' ? [...webFont.value.weights] : [400, 600, 700],
  )

  const customFamily = ref(webFont.value?.source === 'custom' ? webFont.value.family : '')
  const customFiles = ref<Record<string, string>>(
    webFont.value?.source === 'custom' ? { ...webFont.value.files } : {},
  )
  const customWeight = ref('400')
  const licenseAccepted = ref(webFont.value?.source === 'custom')
  const fontError = ref<string | null>(null)
  const fontUploading = ref(false)
  const fontInput = ref<HTMLInputElement | null>(null)

  const customWeightCount = computed(() => Object.keys(customFiles.value).length)
  const customFull = computed(() => customWeightCount.value >= 4)

  function writeWebFont(font: WebFont | null) {
    const typography = { ...tokens.value.typography }
    if (font) typography.webFont = font
    else delete typography.webFont
    tokens.value = { ...tokens.value, typography }
  }

  function applyCurated() {
    if (curatedWeights.value.length === 0) return
    writeWebFont({
      source: 'curated',
      family: curatedFamily.value as WebFont['family'] & string,
      weights: [...curatedWeights.value].sort((a, b) => a - b),
    } as WebFont)
  }

  function toggleWeight(w: number) {
    const set = new Set(curatedWeights.value)
    if (set.has(w)) {
      if (set.size === 1) return
      set.delete(w)
    } else {
      set.add(w)
    }
    curatedWeights.value = [...set]
    applyCurated()
  }

  watch([curatedFamily], () => {
    if (fontMode.value === 'curated') applyCurated()
    void loadCuratedPreview()
  })

  async function uploadFont(file: File) {
    if (!customFamily.value.trim()) {
      fontError.value = t('brandAssets.errFamilyFirst')
      return
    }
    fontError.value = null
    fontUploading.value = true
    try {
      const res = await $fetch<{ file: string; weight: number }>(
        `/api/projects/${props.projectId}/assets/font`,
        {
          method: 'POST',
          body: file,
          query: { family: customFamily.value.trim(), weight: Number(customWeight.value) },
        },
      )
      customFiles.value = { ...customFiles.value, [String(res.weight)]: res.file }
      writeWebFont({
        source: 'custom',
        family: customFamily.value.trim(),
        weights: Object.keys(customFiles.value)
          .map(Number)
          .sort((a, b) => a - b),
        files: { ...customFiles.value },
      } as WebFont)
      void previewCustomFont(file, res.weight)
    } catch (err) {
      const code = (err as { data?: { data?: { code?: string } } }).data?.data?.code
      fontError.value =
        code === 'too_large' ? t('brandAssets.errTooLarge') : t('brandAssets.errFontFormat')
    } finally {
      fontUploading.value = false
    }
  }

  function removeCustomWeight(w: string) {
    const next = Object.fromEntries(
      Object.entries(customFiles.value).filter(([weight]) => weight !== w),
    )
    customFiles.value = next
    if (Object.keys(next).length === 0) {
      writeWebFont(null)
      return
    }
    writeWebFont({
      source: 'custom',
      family: customFamily.value.trim(),
      weights: Object.keys(next)
        .map(Number)
        .sort((a, b) => a - b),
      files: { ...next },
    } as WebFont)
  }

  // ── Live preview ────────────────────────────────────────────────────────
  // Kuraterede fonte ligger allerede i node_modules (@fontsource, slice 4) —
  // import.meta.glob lazy-loader præcis den valgte families css i klienten,
  // så previewen viser den ÆGTE font uden eksterne kald (selfhost-doktrinen).
  const curatedCss = import.meta.glob('/node_modules/@fontsource/*/{400,500,600,700}.css')
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
      WEIGHTS.map((w) => curatedCss[`/node_modules/@fontsource/${pkg}/${w}.css`]?.()),
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

  const previewFamily = computed(() => {
    if (fontMode.value === 'custom' && customFamily.value.trim()) return customFamily.value.trim()
    return curatedFamily.value
  })
</script>

<template>
  <div class="flex flex-col gap-4 mt-6">
    <!-- ── Logo ─────────────────────────────────────────────────────── -->
    <GTCard :title="t('brandAssets.logoTitle')">
      <p class="text-tertiary text-sm mt-0 mb-4">{{ t('brandAssets.logoSub') }}</p>
      <div class="flex gap-4 items-start">
        <div class="brand-logo-preview" aria-hidden="true">
          <img v-if="logoPreviewUrl" :src="logoPreviewUrl" alt="" />
          <span v-else-if="logo" class="text-tertiary text-sm">{{ logo.file }}</span>
          <span v-else class="text-tertiary">—</span>
        </div>
        <div class="flex-1 flex flex-col gap-2">
          <button
            v-if="canEdit"
            type="button"
            class="brand-dropzone"
            :disabled="logoUploading"
            @click="logoInput?.click()"
            @dragover.prevent
            @drop.prevent="
              (e: DragEvent) => e.dataTransfer?.files[0] && uploadLogo(e.dataTransfer.files[0])
            "
          >
            {{ logoUploading ? t('brandAssets.uploading') : t('brandAssets.dropzone') }}
          </button>
          <input
            ref="logoInput"
            type="file"
            accept=".svg,.png,image/svg+xml,image/png"
            class="visually-hidden"
            @change="
              (e: Event) => {
                const f = (e.target as HTMLInputElement).files?.[0]
                if (f) uploadLogo(f)
              }
            "
          />
          <p class="text-tertiary text-xs m-0">{{ t('brandAssets.logoRules') }}</p>
          <GTAlert v-if="logoError" variant="error" :heading="logoError" />
          <GTButton v-if="logo && canEdit" variant="secondary" size="sm" @click="removeLogo">
            {{ t('brandAssets.removeLogo') }}
          </GTButton>
        </div>
      </div>
    </GTCard>

    <!-- ── Skrifttype ───────────────────────────────────────────────── -->
    <GTCard :title="t('brandAssets.fontTitle')">
      <p class="text-tertiary text-sm mt-0 mb-4">{{ t('brandAssets.fontSub') }}</p>

      <div class="brand-font-mode" role="tablist">
        <button
          type="button"
          :class="{ on: fontMode === 'curated' }"
          @click="((fontMode = 'curated'), applyCurated())"
        >
          {{ t('brandAssets.modeCurated') }}
        </button>
        <button type="button" :class="{ on: fontMode === 'custom' }" @click="fontMode = 'custom'">
          {{ t('brandAssets.modeCustom') }}
        </button>
      </div>

      <template v-if="fontMode === 'curated'">
        <GTSelect
          v-model="curatedFamily"
          :label="t('brandAssets.familyLabel')"
          :options="CURATED.map((f) => ({ value: f, label: f }))"
          :disabled="!canEdit"
        />
        <div class="mt-4">
          <p class="text-sm font-medium mb-2 mt-0">
            {{ t('brandAssets.weightsLabel') }}
            <span class="text-tertiary font-normal">{{ t('brandAssets.weightsHint') }}</span>
          </p>
          <div class="brand-weight-chips">
            <label
              v-for="w in WEIGHTS"
              :key="w"
              class="brand-weight-chip"
              :class="{ on: curatedWeights.includes(w) }"
            >
              <input
                type="checkbox"
                :checked="curatedWeights.includes(w)"
                :disabled="!canEdit"
                @change="toggleWeight(w)"
              />
              {{ WEIGHT_LABELS[w] }}
            </label>
          </div>
        </div>
      </template>

      <template v-else>
        <GTInput
          v-model="customFamily"
          :label="t('brandAssets.customFamilyLabel')"
          :disabled="!canEdit"
          class="mb-3"
        />
        <div class="brand-license mb-3">
          <input id="font-license" v-model="licenseAccepted" type="checkbox" :disabled="!canEdit" />
          <label for="font-license" class="text-sm">
            {{ t('brandAssets.license') }}
            <NuxtLink to="/legal/cookies" class="text-primary">{{
              t('brandAssets.licenseMore')
            }}</NuxtLink>
          </label>
        </div>
        <template v-if="!customFull">
          <GTSelect
            v-model="customWeight"
            :label="t('brandAssets.weightForFile')"
            :options="WEIGHTS.map((w) => ({ value: String(w), label: WEIGHT_LABELS[w] }))"
            :disabled="!canEdit || !licenseAccepted"
            class="mb-2"
          />
          <button
            v-if="canEdit"
            type="button"
            class="brand-dropzone"
            :disabled="fontUploading || !licenseAccepted"
            @click="fontInput?.click()"
            @dragover.prevent
            @drop.prevent="
              (e: DragEvent) => e.dataTransfer?.files[0] && uploadFont(e.dataTransfer.files[0])
            "
          >
            {{ fontUploading ? t('brandAssets.uploading') : t('brandAssets.fontDropzone') }}
          </button>
          <input
            ref="fontInput"
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
        <p v-else class="text-tertiary text-sm">{{ t('brandAssets.maxWeights') }}</p>
        <GTAlert v-if="fontError" variant="error" :heading="fontError" class="mt-2" />
        <ul v-if="customWeightCount > 0" class="list-reset mt-3 flex flex-col gap-1">
          <li
            v-for="(file, w) in customFiles"
            :key="w"
            class="flex items-center justify-between text-sm"
          >
            <span
              >{{ WEIGHT_LABELS[Number(w)] }} · <code>{{ file }}</code></span
            >
            <GTButton
              v-if="canEdit"
              variant="outlined"
              size="sm"
              @click="removeCustomWeight(String(w))"
            >
              {{ t('brandAssets.remove') }}
            </GTButton>
          </li>
        </ul>
      </template>

      <div class="brand-font-preview" :style="{ fontFamily: `'${previewFamily}', sans-serif` }">
        <p class="brand-font-preview__label">{{ t('brandAssets.previewLabel') }}</p>
        <p class="brand-font-preview__h">{{ t('brandAssets.previewHeading') }}</p>
        <p class="brand-font-preview__b">{{ t('brandAssets.previewBody') }}</p>
      </div>
    </GTCard>
  </div>
</template>
