<script setup lang="ts">
  import { applyThemeToDOM } from '@grundtone/vue'
  import { createTheme } from '@grundtone/core'
  import type { Tokens } from '~~/server/lib/tokens'

  const props = defineProps<{ tokens: Tokens }>()

  const previewRoot = useTemplateRef<HTMLDivElement>('previewRoot')

  watchEffect(() => {
    if (!previewRoot.value) return
    try {
      const theme = createTheme({ light: props.tokens })
      applyThemeToDOM(theme, previewRoot.value)
    } catch (err) {
      console.warn('Failed to apply preview theme', err)
    }
  })
</script>

<template>
  <div ref="previewRoot" class="token-preview p-6 border rounded-lg">
    <h2 class="mt-0">Preview</h2>
    <p class="text-secondary">Editor-changes apply live to this isolated container.</p>

    <div class="flex flex-col gap-4 mt-6">
      <div class="flex gap-3">
        <GTButton variant="primary">Primary</GTButton>
        <GTButton variant="secondary">Secondary</GTButton>
        <GTButton variant="tertiary">Tertiary</GTButton>
      </div>

      <div class="flex gap-3">
        <GTBadge variant="primary">primary</GTBadge>
        <GTBadge variant="success">success</GTBadge>
        <GTBadge variant="warning">warning</GTBadge>
        <GTBadge variant="error">error</GTBadge>
        <GTBadge variant="info">info</GTBadge>
      </div>

      <GTInput label="Sample input" placeholder="Type something …" />

      <GTAlert variant="info" heading="Heads up">This alert previews the info palette.</GTAlert>

      <GTCard variant="default">
        <h3 class="mt-0">Card heading</h3>
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
