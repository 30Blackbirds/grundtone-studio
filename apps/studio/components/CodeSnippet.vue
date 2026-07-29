<script setup lang="ts">
  // Interim mirror of GTCodeBlock (@grundtone/vue develop, unreleased) —
  // redesign R7 / redesign-r7-apikeys-install.html: ONE snippet surface with
  // language label (+ optional filename) and a copy button, used everywhere
  // code is shown (install snippets, integration guide). Swap to GTCodeBlock
  // when the `next` prerelease ships — same ConfirmDialog-mirror strategy.
  defineProps<{
    code: string
    language: string
    filename?: string
    label?: string
  }>()

  const { t } = useI18n()
  const copyState = ref<'idle' | 'copied'>('idle')

  async function copy(code: string) {
    await navigator.clipboard.writeText(code)
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  }
</script>

<template>
  <div class="border rounded-lg overflow-hidden">
    <div class="flex justify-between items-center px-3 py-2 bg-surface-raised border-b">
      <span class="flex items-center gap-2 text-sm">
        <strong v-if="label">{{ label }}</strong>
        <code v-if="filename" class="font-mono text-tertiary">{{ filename }}</code>
        <GTBadge variant="neutral">{{ language }}</GTBadge>
      </span>
      <GTButton variant="outlined" size="sm" @click="copy(code)">
        {{ copyState === 'copied' ? t('apiKeys.copied') : t('apiKeys.copy') }}
      </GTButton>
    </div>
    <pre class="m-0 p-3 bg-surface font-mono text-sm overflow-x-auto"><code>{{ code }}</code></pre>
  </div>
</template>
