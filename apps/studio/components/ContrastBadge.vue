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
  <div class="flex flex-wrap items-center gap-3 p-3 border rounded-lg bg-surface-raised">
    <span
      class="contrast-swatch"
      :style="{ background: bg ?? 'transparent', color: fg ?? 'inherit' }"
      aria-hidden="true"
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
  /* 🔴 THE BADGE MUST BE ABLE TO WRAP, because its content is a SENTENCE and
     not a tag (KH-1124). The library gives `.gt-badge` `white-space: nowrap`
     with `min-width: auto`, which is right for "AA" or "Published" — it is not
     right for "AA (kun store skrifttyper)", 181px of it, and that string is
     ours, not the library's.

     Measured: with the columns fixed the chip is wide enough today, so this is
     not what cures the clip. It is what stops the NEXT translation curing it
     back — a label can grow past any fixed cell, and a nowrap element that
     cannot shrink turns that into clipped pixels rather than a second line.
     Scoped to this component: the rest of the app's badges are short labels
     and keep the library's behaviour. */
  :deep(.gt-badge) {
    white-space: normal;
    text-align: start;
  }

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
