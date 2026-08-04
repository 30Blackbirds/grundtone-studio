<script setup lang="ts">
  // Brand-assets-sektionen i Tokens-fanen (forlæg redesign-brand-assets.html,
  // to-slot-revisionen 2026-08-04). Bevidst en SEKTION og ikke egen fane:
  // assets publiceres MED farve-tokens i samme kladde/publicér-cyklus (sidens
  // header er den fælles linje). Font-delen er TO slots (Font 1/overskrift +
  // Font 2/brødtekst) med Allan-loftet "4 fontfiler i alt" på tværs af begge.
  import type { FontSlot, Tokens } from '~~/server/lib/tokens'

  const props = defineProps<{ projectId: string; canEdit: boolean }>()
  const tokens = defineModel<Tokens>({ required: true })

  const { t } = useI18n()

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

  // ── Font-slots ──────────────────────────────────────────────────────────
  function slotModel(key: 'heading' | 'body') {
    return computed<FontSlot | null>({
      get: () => tokens.value.typography?.slots?.[key] ?? null,
      set: (slot) => {
        const prev = tokens.value.typography?.slots ?? {}
        const slots = Object.fromEntries(
          Object.entries({ ...prev, [key]: slot }).filter(([, v]) => v != null),
        ) as NonNullable<NonNullable<Tokens['typography']>['slots']>
        const { slots: _drop, ...restTypography } = tokens.value.typography ?? {}
        const typography =
          Object.keys(slots).length > 0 ? { ...restTypography, slots } : restTypography
        tokens.value = { ...tokens.value, typography }
      },
    })
  }
  const headingSlot = slotModel('heading')
  const bodySlot = slotModel('body')

  // Allan-loftet: 4 fontfiler I ALT på tværs af begge slots (kuraterede
  // vægte tæller som filer — de lastes fra CDN'et). Samme resterende budget
  // gives til begge editors; schemaet håndhæver hårdt ved draft-save.
  function slotFiles(slot: FontSlot | null): number {
    if (!slot) return 0
    return slot.source === 'custom' ? Object.keys(slot.files).length : slot.weights.length
  }
  const remainingBudget = computed(
    () => 4 - slotFiles(headingSlot.value) - slotFiles(bodySlot.value),
  )

  const previewHeadingFamily = computed(() => headingSlot.value?.family ?? null)
  const previewBodyFamily = computed(() => bodySlot.value?.family ?? null)
</script>

<template>
  <div class="flex flex-col gap-4 mt-6">
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

    <FontSlotEditor
      v-model="headingSlot"
      slot-key="heading"
      :project-id="projectId"
      :can-edit="canEdit"
      :remaining-budget="remainingBudget"
    />
    <FontSlotEditor
      v-model="bodySlot"
      slot-key="body"
      :project-id="projectId"
      :can-edit="canEdit"
      :remaining-budget="remainingBudget"
    />

    <!-- Kombineret preview (forlæggets pointe med to slots: se dem SAMMEN) -->
    <GTCard :title="t('brandAssets.previewTitle')">
      <p class="text-tertiary text-sm mt-0 mb-4">{{ t('brandAssets.previewSub') }}</p>
      <div class="brand-combo-preview">
        <p
          class="brand-combo-preview__h"
          :style="
            previewHeadingFamily ? { fontFamily: `'${previewHeadingFamily}', sans-serif` } : {}
          "
        >
          {{ t('brandAssets.previewHeading') }}
        </p>
        <p
          class="brand-combo-preview__b"
          :style="previewBodyFamily ? { fontFamily: `'${previewBodyFamily}', sans-serif` } : {}"
        >
          {{ t('brandAssets.previewBody') }}
        </p>
        <div class="brand-combo-preview__caption">
          <span v-if="previewHeadingFamily">
            <b>{{ t('brandAssets.slot.heading.title') }}</b> {{ previewHeadingFamily }}
          </span>
          <span v-if="previewBodyFamily">
            <b>{{ t('brandAssets.slot.body.title') }}</b> {{ previewBodyFamily }}
          </span>
        </div>
      </div>
    </GTCard>
  </div>
</template>
