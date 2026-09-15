<script setup lang="ts">
  const { t } = useI18n()
  const { state, back } = useOnboardingState()

  type FetchFn = <T>(url: string, opts?: unknown) => Promise<T>
  const fetcher = $fetch as unknown as FetchFn

  const status = ref<'idle' | 'publishing' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  async function runFinalizeOnce() {
    // Allow retries from the error state so the "Try again" button works;
    // block re-entry while a finalize is already in flight or completed.
    if ((status.value !== 'idle' && status.value !== 'error') || !state.value.projectId) return
    errorMessage.value = null
    status.value = 'publishing'
    try {
      await fetcher(`/api/projects/${state.value.projectId}/publish`, { method: 'POST' })

      const keyRes = await fetcher<{ plaintext: string }>(
        `/api/projects/${state.value.projectId}/api-keys`,
        {
          method: 'POST',
          body: { environment: 'live', allowedOrigins: [] },
        },
      )
      state.value.apiKey = keyRes.plaintext
      status.value = 'ready'
    } catch (err) {
      const data = (err as { data?: { data?: { code?: string; limit?: number } } }).data?.data
      errorMessage.value =
        data?.code === 'brand_quota_exceeded'
          ? t('quota.brandBody', { limit: data.limit ?? 0 })
          : ((err as Error).message ?? t('onboarding.install.error'))
      status.value = 'error'
    }
  }

  onMounted(runFinalizeOnce)

  function goToProject() {
    if (!state.value.orgSlug || !state.value.projectSlug) return
    navigateTo(`/orgs/${state.value.orgSlug}/projects/${state.value.projectSlug}`)
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex flex-col gap-2">
      <h1 class="m-0">{{ t('onboarding.install.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('onboarding.install.subtitle') }}</p>
    </header>

    <GTAlert
      v-if="status === 'publishing'"
      variant="info"
      :heading="t('onboarding.install.publishing')"
    />

    <GTAlert
      v-else-if="status === 'error'"
      variant="error"
      :heading="errorMessage ?? t('onboarding.install.error')"
    >
      <GTButton variant="secondary" size="sm" @click="runFinalizeOnce">
        {{ t('onboarding.install.retry') }}
      </GTButton>
    </GTAlert>

    <template v-else-if="status === 'ready'">
      <GTAlert variant="success" :heading="t('onboarding.install.successHeading')">
        {{ t('onboarding.install.successBody') }}
      </GTAlert>
      <InstallSnippet :api-key="state.apiKey" />
    </template>

    <div class="flex justify-between">
      <GTButton type="button" variant="secondary" :disabled="status === 'publishing'" @click="back">
        {{ t('onboarding.back') }}
      </GTButton>
      <GTButton :disabled="status !== 'ready'" @click="goToProject">
        {{ t('onboarding.install.finish') }}
      </GTButton>
    </div>
  </div>
</template>
