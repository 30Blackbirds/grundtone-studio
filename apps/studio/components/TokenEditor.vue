<script setup lang="ts">
  import type { Tokens } from '~~/server/lib/tokens'

  const tokens = defineModel<Tokens>({ required: true })
  const { t } = useI18n()

  // Light/dark editing mode. Dark is an OVERRIDE layer (decision 2026-07-29):
  // only colors, and only the ones that differ. The parent (preview) follows
  // via the emitted mode.
  const mode = defineModel<'base' | 'dark'>('mode', { default: 'base' })

  // Reactive sub-objects (Vue v-model proxies don't auto-create nested paths).
  // Each computed widens the optional schema field into its non-null object
  // shape so deep property access type-checks.
  type Colors = NonNullable<Tokens['colors']>
  type Typography = NonNullable<Tokens['typography']>
  type Radius = NonNullable<Tokens['radius']>
  type Spacing = NonNullable<Tokens['spacing']>
  type FontFamily = NonNullable<Typography['fontFamily']>

  const darkOverrides = computed<Colors>(() => tokens.value.dark?.colors ?? {})
  const darkOverrideCount = computed(() => Object.keys(darkOverrides.value).length)

  // In dark mode the fields show EFFECTIVE values (base merged with the
  // override layer), so the designer sees what dark actually renders.
  const colors = computed<Colors>({
    get: () =>
      mode.value === 'dark'
        ? { ...(tokens.value.colors ?? {}), ...darkOverrides.value }
        : (tokens.value.colors ?? {}),
    set: (v) => (tokens.value = { ...tokens.value, colors: v }),
  })

  function clearDarkOverrides() {
    const { dark: _dark, ...rest } = tokens.value
    tokens.value = rest
  }
  const typography = computed<Typography>({
    get: () => tokens.value.typography ?? {},
    set: (v) => (tokens.value = { ...tokens.value, typography: v }),
  })
  const radius = computed<Radius>({
    get: () => tokens.value.radius ?? {},
    set: (v) => (tokens.value = { ...tokens.value, radius: v }),
  })
  const spacing = computed<Spacing>({
    get: () => tokens.value.spacing ?? {},
    set: (v) => (tokens.value = { ...tokens.value, spacing: v }),
  })

  const fontFamily = computed<FontFamily>({
    get: () => typography.value.fontFamily ?? {},
    set: (v) => (typography.value = { ...typography.value, fontFamily: v }),
  })

  function updateColor(key: keyof NonNullable<Tokens['colors']>, value: string) {
    if (mode.value === 'dark') {
      // Dark writes go to the override layer. Clearing a field removes the
      // override, falling back to the base value — that IS the reset gesture.
      const next: Colors = value
        ? { ...darkOverrides.value, [key]: value }
        : (Object.fromEntries(
            Object.entries(darkOverrides.value).filter(([k]) => k !== key),
          ) as Colors)
      if (Object.keys(next).length === 0) {
        clearDarkOverrides()
      } else {
        tokens.value = { ...tokens.value, dark: { colors: next } }
      }
      return
    }
    colors.value = { ...colors.value, [key]: value }
  }
  function updateRadius(key: keyof NonNullable<Tokens['radius']>, value: string) {
    radius.value = { ...radius.value, [key]: value }
  }
  function updateSpacing(key: keyof NonNullable<Tokens['spacing']>, value: string) {
    spacing.value = { ...spacing.value, [key]: value }
  }
  function updateFont(key: 'base' | 'heading' | 'mono', value: string) {
    fontFamily.value = { ...fontFamily.value, [key]: value }
  }
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex items-center justify-between gap-4">
      <div class="flex gap-2" role="group" :aria-label="t('tokens.modeLabel')">
        <GTButton
          :variant="mode === 'base' ? 'primary' : 'secondary'"
          size="sm"
          :aria-pressed="mode === 'base'"
          @click="mode = 'base'"
        >
          {{ t('tokens.modeBase') }}
        </GTButton>
        <GTButton
          :variant="mode === 'dark' ? 'primary' : 'secondary'"
          size="sm"
          :aria-pressed="mode === 'dark'"
          @click="mode = 'dark'"
        >
          {{ t('tokens.modeDark') }}
          <template v-if="darkOverrideCount"> ({{ darkOverrideCount }})</template>
        </GTButton>
      </div>
      <GTButton
        v-if="mode === 'dark' && darkOverrideCount"
        variant="outlined"
        size="sm"
        @click="clearDarkOverrides"
      >
        {{ t('tokens.clearDark') }}
      </GTButton>
    </div>

    <GTAlert v-if="mode === 'dark'" variant="info" :heading="t('tokens.darkHint')">
      <p class="m-0 text-sm">{{ t('tokens.darkHintBody') }}</p>
    </GTAlert>

    <section>
      <h3 class="mt-0 mb-3">{{ t('tokens.colors') }}</h3>
      <div class="grid grid-cols-2 gap-4">
        <TokenColorField
          :label="t('tokens.color.primary')"
          :model-value="colors.primary"
          @update:model-value="(v) => updateColor('primary', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.primaryLight')"
          :model-value="colors.primaryLight"
          @update:model-value="(v) => updateColor('primaryLight', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.primaryDark')"
          :model-value="colors.primaryDark"
          @update:model-value="(v) => updateColor('primaryDark', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.onPrimary')"
          :model-value="colors.onPrimary"
          @update:model-value="(v) => updateColor('onPrimary', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.secondary')"
          :model-value="colors.secondary"
          @update:model-value="(v) => updateColor('secondary', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.success')"
          :model-value="colors.success"
          @update:model-value="(v) => updateColor('success', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.warning')"
          :model-value="colors.warning"
          @update:model-value="(v) => updateColor('warning', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.error')"
          :model-value="colors.error"
          @update:model-value="(v) => updateColor('error', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.info')"
          :model-value="colors.info"
          @update:model-value="(v) => updateColor('info', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.background')"
          :model-value="colors.background"
          @update:model-value="(v) => updateColor('background', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.surface')"
          :model-value="colors.surface"
          @update:model-value="(v) => updateColor('surface', v ?? '')"
        />
        <TokenColorField
          :label="t('tokens.color.text')"
          :model-value="colors.text"
          @update:model-value="(v) => updateColor('text', v ?? '')"
        />
      </div>
    </section>

    <section>
      <h3 class="mt-0 mb-3">{{ t('tokens.contrast') }}</h3>
      <p class="text-tertiary text-sm mt-0 mb-3">{{ t('tokens.contrastHint') }}</p>
      <div class="grid grid-cols-2 gap-3">
        <!-- Each pair below covers a real visual surface in the rendered theme.
             AAA = comfortable for body copy; AA = legal minimum; AA-large only
             passes for headings or UI; fail = needs fixing. -->
        <ContrastBadge
          :label="t('contrast.pair.textOnBackground')"
          :fg="colors.text"
          :bg="colors.background"
        />
        <ContrastBadge
          :label="t('contrast.pair.textOnSurface')"
          :fg="colors.text"
          :bg="colors.surface"
        />
        <ContrastBadge
          :label="t('contrast.pair.textSecondaryOnBackground')"
          :fg="colors.textSecondary"
          :bg="colors.background"
        />
        <ContrastBadge
          :label="t('contrast.pair.textTertiaryOnBackground')"
          :fg="colors.textTertiary"
          :bg="colors.background"
        />
        <ContrastBadge
          :label="t('contrast.pair.onPrimaryOnPrimary')"
          :fg="colors.onPrimary"
          :bg="colors.primary"
        />
        <ContrastBadge
          :label="t('contrast.pair.onPrimaryOnPrimaryDark')"
          :fg="colors.onPrimary"
          :bg="colors.primaryDark"
        />
      </div>
    </section>

    <section v-if="mode === 'base'">
      <h3 class="mt-0 mb-3">{{ t('tokens.typography') }}</h3>
      <div class="grid grid-cols-2 gap-4">
        <GTInput
          :model-value="fontFamily.base"
          :label="t('tokens.font.base')"
          placeholder="Inter, system-ui, sans-serif"
          @update:model-value="(v) => updateFont('base', String(v))"
        />
        <GTInput
          :model-value="fontFamily.heading"
          :label="t('tokens.font.heading')"
          placeholder="Inter, system-ui, sans-serif"
          @update:model-value="(v) => updateFont('heading', String(v))"
        />
      </div>
    </section>

    <section v-if="mode === 'base'">
      <h3 class="mt-0 mb-3">{{ t('tokens.radius') }}</h3>
      <div class="grid grid-cols-4 gap-4">
        <GTInput
          :model-value="radius.sm"
          label="sm"
          placeholder="0.25rem"
          @update:model-value="(v) => updateRadius('sm', String(v))"
        />
        <GTInput
          :model-value="radius.md"
          label="md"
          placeholder="0.5rem"
          @update:model-value="(v) => updateRadius('md', String(v))"
        />
        <GTInput
          :model-value="radius.lg"
          label="lg"
          placeholder="0.75rem"
          @update:model-value="(v) => updateRadius('lg', String(v))"
        />
        <GTInput
          :model-value="radius.xl"
          label="xl"
          placeholder="1rem"
          @update:model-value="(v) => updateRadius('xl', String(v))"
        />
      </div>
    </section>

    <section v-if="mode === 'base'">
      <h3 class="mt-0 mb-3">{{ t('tokens.spacing') }}</h3>
      <p class="text-tertiary text-sm mt-0 mb-3">{{ t('tokens.spacingHint') }}</p>
      <div class="grid grid-cols-3 gap-4">
        <GTInput
          :model-value="spacing.sm"
          label="sm"
          placeholder="0.5rem"
          @update:model-value="(v) => updateSpacing('sm', String(v))"
        />
        <GTInput
          :model-value="spacing.md"
          label="md"
          placeholder="1rem"
          @update:model-value="(v) => updateSpacing('md', String(v))"
        />
        <GTInput
          :model-value="spacing.lg"
          label="lg"
          placeholder="1.5rem"
          @update:model-value="(v) => updateSpacing('lg', String(v))"
        />
      </div>
    </section>
  </div>
</template>
