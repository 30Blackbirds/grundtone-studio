<script setup lang="ts">
  import { createTheme } from '@grundtone/core'
  import { isCssLength } from '~~/utils/css-values'
  import type { Tokens, ColorSlot } from '~~/server/lib/tokens'
  import {
    COLOR_SLOT_GROUPS,
    INLINE_CONTRAST,
    type ColorSlotGroup,
  } from '~~/utils/color-slot-groups'

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
        ? { ...tokens.value.colors, ...darkOverrides.value }
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

  // "Auto"-værdien for en slot uden override = hvad @grundtone/core's
  // createTheme RESOLVER for det aktuelle sæt. I dag er det stock (core afleder
  // ikke — ren spread over defaultColorPreset), og UI'et siger det ærligt i
  // tooltip'en. Den dag core afleder, viser denne computed automatisk det
  // rigtige tal — intet i editoren skal ændres.
  const resolved = computed(() => {
    const theme = createTheme({
      light: tokens.value.colors ?? {},
      dark: { ...tokens.value.colors, ...darkOverrides.value },
    })
    return (mode.value === 'dark' ? theme.dark : theme.light).colors as Record<ColorSlot, string>
  })

  /** Er slotten eksplicit sat i det lag vi redigerer (base eller dark-override)? */
  function isOverridden(slot: ColorSlot): boolean {
    const layer = mode.value === 'dark' ? darkOverrides.value : (tokens.value.colors ?? {})
    return layer[slot] !== undefined && layer[slot] !== ''
  }

  /**
   * Arver denne slot LYS tilstand i mørk visning? Sandt når den er usat i
   * dark-laget MEN eksplicit sat i light — så viser dark tenantens egen lyse
   * værdi ([designer]s spec 2026-08-19, adfærden målt i
   * dark-resolution-parity.test.ts). Er den usat begge steder, arver den bare
   * stock i begge tilstande — konsistent, ikke en fælde, intet signal.
   * Signal, ikke invariant: hvid surfaceRaised i begge tilstande er tit
   * rigtigt, så publish blokeres ALDRIG af dette.
   */
  function inheritsLight(slot: ColorSlot): boolean {
    // Ingen eksplicit mode-guard: i light-visning læser isOverridden() SAMME
    // objekt som lightValue, så "usat i laget MEN sat i light" er en
    // selvmodsigelse og udtrykket er altid falsk. En guard ville være en gren
    // ingen test kan skelne — målt ved mutation: fjernes den, ændrer intet
    // testresultat. Argumentet står her i stedet for i en uobserverbar linje.
    const lightValue = tokens.value.colors?.[slot]
    return !isOverridden(slot) && lightValue !== undefined && lightValue !== ''
  }

  function inheritsLightInGroup(group: ColorSlotGroup): number {
    if (!group.warnInheritsLight) return 0
    return [...group.base, ...group.derived].filter(inheritsLight).length
  }

  function groupSummary(group: ColorSlotGroup): string | undefined {
    const parts: string[] = []
    const overridden = overriddenInGroup(group.key)
    if (overridden) parts.push(`${t('tokens.editor.customized')} · ${overridden}`)
    const inherits = inheritsLightInGroup(group)
    if (inherits) parts.push(t('tokens.editor.inheritsLightCount', { count: inherits }))
    return parts.length ? parts.join(' · ') : undefined
  }

  // "Vis afledte" pr. gruppe (designer-regel 2: ikke globalt).
  const showDerived = reactive<Record<string, boolean>>({})
  function overriddenInGroup(key: string): number {
    const g = COLOR_SLOT_GROUPS.find((x) => x.key === key)
    return g ? g.derived.filter(isOverridden).length : 0
  }

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

  // Inline live-validation for length fields (UX-audit finding #8). Colors
  // validate inside TokenColorField; empty is always fine (optional tokens).
  function lengthError(value: string | undefined): string | undefined {
    return value && !isCssLength(value) ? t('validation.cssLength') : undefined
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
      <!-- Grupperne er data (se color-slot-groups i utils), efter designerens
           forlæg: ni base-felter er altid synlige, resten er afledte og ligger
           bag en toggle i hver enkelt gruppe. Et felt uden override viser den
           resolvede værdi som "auto" — i dag stock, se kommentaren ved
           resolved ovenfor. Er feltet udfyldt, vises "tilpasset" med nulstil. -->
      <GTAccordion>
        <GTAccordionItem
          v-for="group in COLOR_SLOT_GROUPS"
          :key="group.key"
          :heading="t(`tokens.group.${group.key}`)"
          :summary="groupSummary(group)"
          :open="group.open"
          :heading-level="4"
        >
          <div v-if="group.base.length" class="token-grid gap-4">
            <div v-for="slot in group.base" :key="slot" class="flex flex-col gap-1">
              <TokenColorField
                :label="t(`tokens.color.${slot}`)"
                :model-value="colors[slot]"
                @update:model-value="(v) => updateColor(slot, v ?? '')"
              />
              <code class="text-xs text-tertiary">{{ slot }}</code>
              <span
                v-if="group.warnInheritsLight && inheritsLight(slot)"
                class="inherits-light"
                :title="t('tokens.editor.inheritsLight', { value: resolved[slot] })"
              >
                <span aria-hidden="true">●</span>
                {{ t('tokens.editor.inheritsLightShort') }}
              </span>
              <ContrastBadge
                v-if="INLINE_CONTRAST[slot]"
                :label="t(`contrast.inline.${INLINE_CONTRAST[slot]!.labelKey}`)"
                :fg="resolved[INLINE_CONTRAST[slot]!.fg]"
                :bg="resolved[INLINE_CONTRAST[slot]!.bg]"
              />
            </div>
          </div>

          <div v-if="group.derived.length" class="mt-3">
            <GTButton
              variant="unstyled"
              size="sm"
              class="text-sm"
              :aria-expanded="!!showDerived[group.key]"
              @click="showDerived[group.key] = !showDerived[group.key]"
            >
              {{
                showDerived[group.key]
                  ? t('tokens.editor.hideDerived')
                  : t('tokens.editor.showDerived', { count: group.derived.length })
              }}
            </GTButton>
            <div v-if="showDerived[group.key]" class="token-grid gap-4 mt-3">
              <div v-for="slot in group.derived" :key="slot" class="flex flex-col gap-1">
                <TokenColorField
                  :label="t(`tokens.color.${slot}`)"
                  :model-value="isOverridden(slot) ? colors[slot] : undefined"
                  :placeholder="resolved[slot]"
                  :title="isOverridden(slot) ? undefined : t('tokens.editor.autoHint')"
                  @update:model-value="(v) => updateColor(slot, v ?? '')"
                />
                <span class="flex items-center gap-2 text-xs">
                  <code class="text-tertiary">{{ slot }}</code>
                  <span
                    v-if="group.warnInheritsLight && inheritsLight(slot)"
                    class="inherits-light"
                    :title="t('tokens.editor.inheritsLight', { value: resolved[slot] })"
                  >
                    <span aria-hidden="true">●</span>
                    {{ t('tokens.editor.inheritsLightShort') }}
                  </span>
                  <template v-if="isOverridden(slot)">
                    <span class="text-primary" aria-hidden="true">●</span>
                    <span>{{ t('tokens.editor.customized') }}</span>
                    <GTButton variant="unstyled" size="sm" @click="updateColor(slot, '')">
                      {{ t('tokens.editor.resetToAuto') }}
                    </GTButton>
                  </template>
                  <span v-else class="text-tertiary"
                    >{{ t('tokens.editor.auto') }} · {{ resolved[slot] }}</span
                  >
                </span>
              </div>
            </div>
          </div>
        </GTAccordionItem>
      </GTAccordion>
    </section>

    <section>
      <h3 class="mt-0 mb-3">{{ t('tokens.contrast') }}</h3>
      <p class="text-tertiary text-sm mt-0 mb-3">{{ t('tokens.contrastHint') }}</p>
      <!-- KUN par der ikke allerede står inline ved et base-felt ([designer]-
           review af #228): samme tal to steder kan divergere. Inline dækker
           text/background, text/surface, onPrimary/primary, text/secondary.
           Her: de sekundære tekst-trin og primærens hover/pressed-tilstande —
           dem brugere glemmer. -->
      <div class="token-grid gap-3">
        <ContrastBadge
          :label="t('contrast.pair.textSecondaryOnBackground')"
          :fg="resolved.textSecondary"
          :bg="resolved.background"
        />
        <ContrastBadge
          :label="t('contrast.pair.textTertiaryOnBackground')"
          :fg="resolved.textTertiary"
          :bg="resolved.background"
          size="large"
        />
        <ContrastBadge
          :label="t('contrast.pair.onPrimaryOnPrimaryDark')"
          :fg="resolved.onPrimary"
          :bg="resolved.primaryDark"
        />
        <ContrastBadge
          :label="t('contrast.pair.onPrimaryOnPrimaryLight')"
          :fg="resolved.onPrimary"
          :bg="resolved.primaryLight"
        />
      </div>
    </section>

    <section v-if="mode === 'base'">
      <h3 class="mt-0 mb-3">{{ t('tokens.typography') }}</h3>
      <div class="token-grid gap-4">
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
          :error-text="lengthError(radius.sm)"
          placeholder="0.25rem"
          @update:model-value="(v) => updateRadius('sm', String(v))"
        />
        <GTInput
          :model-value="radius.md"
          label="md"
          :error-text="lengthError(radius.md)"
          placeholder="0.5rem"
          @update:model-value="(v) => updateRadius('md', String(v))"
        />
        <GTInput
          :model-value="radius.lg"
          label="lg"
          :error-text="lengthError(radius.lg)"
          placeholder="0.75rem"
          @update:model-value="(v) => updateRadius('lg', String(v))"
        />
        <GTInput
          :model-value="radius.xl"
          label="xl"
          :error-text="lengthError(radius.xl)"
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
          :error-text="lengthError(spacing.sm)"
          placeholder="0.5rem"
          @update:model-value="(v) => updateSpacing('sm', String(v))"
        />
        <GTInput
          :model-value="spacing.md"
          label="md"
          :error-text="lengthError(spacing.md)"
          placeholder="1rem"
          @update:model-value="(v) => updateSpacing('md', String(v))"
        />
        <GTInput
          :model-value="spacing.lg"
          label="lg"
          :error-text="lengthError(spacing.lg)"
          placeholder="1.5rem"
          @update:model-value="(v) => updateSpacing('lg', String(v))"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
  /* Rav, ikke rød: at arve lys tilstand er et SIGNAL, ikke en fejl — hvid
     surfaceRaised i begge tilstande er tit tilsigtet ([designer] 2026-08-19).
     Publish blokeres aldrig af det. */
  .inherits-light {
    color: var(--color-warning-dark, #b8860b);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
</style>
