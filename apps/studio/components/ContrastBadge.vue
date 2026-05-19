<script setup lang="ts">
  import { evaluatePair, type WcagOptions } from '~~/utils/contrast'

  const props = defineProps<{
    fg: string | undefined
    bg: string | undefined
    label: string
    size?: WcagOptions['size']
  }>()

  const result = computed(() => evaluatePair(props.fg, props.bg, { size: props.size }))

  // Map the WCAG level into a grundtone <GTBadge> variant. AAA + AA both
  // "pass", and we tint them slightly differently so a glance at the panel
  // shows where the borderline pairs are.
  const variant = computed<'success' | 'info' | 'warning' | 'error' | 'neutral'>(() => {
    if (!result.value) return 'neutral'
    switch (result.value.level) {
      case 'AAA':
        return 'success'
      case 'AA':
        return 'info'
      case 'AA-large':
        return 'warning'
      case 'fail':
        return 'error'
      default:
        return 'neutral'
    }
  })
</script>

<template>
  <div class="flex items-center gap-3 p-3 border rounded-lg bg-surface-raised">
    <span
      class="contrast-swatch"
      :style="{ background: bg ?? 'transparent', color: fg ?? 'inherit' }"
    >
      Aa
    </span>
    <div class="flex flex-col gap-1 flex-1 min-w-0">
      <span class="text-sm font-bold truncate">{{ label }}</span>
      <span v-if="result" class="text-xs text-tertiary">{{ result.ratio.toFixed(2) }} : 1</span>
      <span v-else class="text-xs text-tertiary">{{ $t('contrast.unparseable') }}</span>
    </div>
    <GTBadge v-if="result" :variant="variant">
      {{ $t(`contrast.level.${result.level}`) }}
    </GTBadge>
    <GTBadge v-else variant="neutral">—</GTBadge>
  </div>
</template>

<style scoped>
  .contrast-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 2.5rem;
    block-size: 2.5rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    font-weight: 700;
    font-size: 0.875rem;
    flex-shrink: 0;
  }
</style>
