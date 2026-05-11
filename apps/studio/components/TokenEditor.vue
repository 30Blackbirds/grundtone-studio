<script setup lang="ts">
  import type { Tokens } from '~~/server/lib/tokens'

  const tokens = defineModel<Tokens>({ required: true })
  const { t } = useI18n()

  // Reactive sub-objects (Vue v-model proxies don't auto-create nested paths).
  // Each computed widens the optional schema field into its non-null object
  // shape so deep property access type-checks.
  type Colors = NonNullable<Tokens['colors']>
  type Typography = NonNullable<Tokens['typography']>
  type Radius = NonNullable<Tokens['radius']>
  type FontFamily = NonNullable<Typography['fontFamily']>

  const colors = computed<Colors>({
    get: () => tokens.value.colors ?? {},
    set: (v) => (tokens.value = { ...tokens.value, colors: v }),
  })
  const typography = computed<Typography>({
    get: () => tokens.value.typography ?? {},
    set: (v) => (tokens.value = { ...tokens.value, typography: v }),
  })
  const radius = computed<Radius>({
    get: () => tokens.value.radius ?? {},
    set: (v) => (tokens.value = { ...tokens.value, radius: v }),
  })

  const fontFamily = computed<FontFamily>({
    get: () => typography.value.fontFamily ?? {},
    set: (v) => (typography.value = { ...typography.value, fontFamily: v }),
  })

  function updateColor(key: keyof NonNullable<Tokens['colors']>, value: string) {
    colors.value = { ...colors.value, [key]: value }
  }
  function updateRadius(key: keyof NonNullable<Tokens['radius']>, value: string) {
    radius.value = { ...radius.value, [key]: value }
  }
  function updateFont(key: 'base' | 'heading' | 'mono', value: string) {
    fontFamily.value = { ...fontFamily.value, [key]: value }
  }
</script>

<template>
  <div class="flex flex-col gap-8">
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

    <section>
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
  </div>
</template>
