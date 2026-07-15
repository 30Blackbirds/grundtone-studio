<script setup lang="ts">
  const { t } = useI18n()

  const pending = ref(false)
  const error = ref<string | null>(null)

  async function download() {
    pending.value = true
    error.value = null
    try {
      const data = await $fetch<Record<string, unknown>>('/api/account/export', {
        headers: useRequestHeaders(['cookie']) as HeadersInit,
      })
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grundtone-studio-export-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      error.value = (err as Error).message ?? t('account.privacy.exportError')
    } finally {
      pending.value = false
    }
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-tertiary m-0">{{ t('account.privacy.exportHelp') }}</p>
    <GTButton variant="secondary" :loading="pending" @click="download">
      {{ t('account.privacy.export') }}
    </GTButton>
    <GTAlert v-if="error" variant="error" :heading="error" />
    <p class="m-0">
      <NuxtLink to="/privacy" class="text-primary">{{ t('account.privacy.privacyLink') }}</NuxtLink>
    </p>
  </div>
</template>
