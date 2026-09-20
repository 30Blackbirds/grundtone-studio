<script setup lang="ts">
  import { applyThemeToDOM } from '@grundtone/vue'
  import { createTheme } from '@grundtone/core'
  import type { Tokens } from '~~/server/lib/tokens'

  const props = defineProps<{ tokens: Tokens }>()

  const previewRoot = useTemplateRef<HTMLDivElement>('previewRoot')

  // createTheme + applyThemeToDOM mutate dozens of CSS custom properties at
  // once, so running them on every drag-pixel of a color picker is wasted
  // work. We debounce to ~100ms — fast enough that the preview still feels
  // live, slow enough that the editor doesn't repaint hundreds of times per
  // second on a sustained drag. The first paint is forced through synchronously
  // so the user never sees a blank preview at mount.
  const DEBOUNCE_MS = 100
  let timer: ReturnType<typeof setTimeout> | null = null

  function applyNow(tokens: Tokens) {
    if (!previewRoot.value) return
    try {
      const themes = createTheme({ light: tokens })
      applyThemeToDOM(themes.light, previewRoot.value)
    } catch (err) {
      console.warn('Failed to apply preview theme', err)
    }
  }

  onMounted(() => applyNow(props.tokens))

  watch(
    () => props.tokens,
    (tokens) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => applyNow(tokens), DEBOUNCE_MS)
    },
    { deep: true },
  )

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })
</script>

<template>
  <div ref="previewRoot" class="token-preview p-6 border rounded-lg">
    <h2 class="mt-0">Preview</h2>
    <p class="text-secondary">Editor-changes apply live to this isolated container.</p>

    <div class="flex flex-col gap-4 mt-6">
      <div class="flex flex-wrap gap-3">
        <GTButton variant="primary">Primary</GTButton>
        <GTButton variant="secondary">Secondary</GTButton>
        <GTButton variant="outlined">Outlined</GTButton>
      </div>

      <div class="flex flex-wrap gap-3">
        <GTBadge variant="info">info</GTBadge>
        <GTBadge variant="success">success</GTBadge>
        <GTBadge variant="warning">warning</GTBadge>
        <GTBadge variant="error">error</GTBadge>
        <GTBadge variant="neutral">neutral</GTBadge>
      </div>

      <GTInput label="Sample input" placeholder="Type something …" />

      <GTAlert variant="info" heading="Heads up">This alert previews the info palette.</GTAlert>

      <GTCard variant="bordered" title="Card heading">
        <p class="m-0">
          A card uses surface, surface-raised, and text tokens together. Adjusting them in the
          editor updates this preview instantly.
        </p>
      </GTCard>
    </div>
  </div>
</template>

<style scoped>
  .token-preview {
    background: var(--color-background);
    color: var(--color-text);
  }
</style>
