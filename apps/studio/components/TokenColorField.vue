<script setup lang="ts">
  import { isCssColor } from '~~/utils/css-values'

  const model = defineModel<string>()
  defineProps<{
    label: string
    placeholder?: string
  }>()

  const { t } = useI18n()

  // Inline live-validation (UX-audit finding #8): flag an invalid color the
  // moment it's typed instead of waiting for the server's 400. Empty is fine —
  // every token field is optional.
  const errorText = computed(() =>
    model.value && !isCssColor(model.value) ? t('validation.cssColor') : undefined,
  )
</script>

<template>
  <label class="flex flex-col gap-2">
    <span class="text-sm font-bold">{{ label }}</span>
    <span class="flex items-center gap-2">
      <input
        type="color"
        :value="model || '#000000'"
        class="token-color-swatch"
        :aria-label="label"
        @input="(e) => (model = (e.target as HTMLInputElement).value)"
      />
      <GTInput
        :model-value="model"
        :placeholder="placeholder ?? '#RRGGBB'"
        size="sm"
        :error-text="errorText"
        @update:model-value="(v) => (model = String(v))"
      />
    </span>
  </label>
</template>

<style scoped>
  .token-color-swatch {
    inline-size: 2.5rem;
    block-size: 2.5rem;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: none;
  }
</style>
