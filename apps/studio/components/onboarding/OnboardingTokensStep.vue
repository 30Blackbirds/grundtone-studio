<script setup lang="ts">
  import { applyThemeToDOM } from '@grundtone/vue'
  import { createTheme } from '@grundtone/core'

  const { t } = useI18n()
  const { state, next, back } = useOnboardingState()

  const submitting = ref(false)
  const error = ref<string | null>(null)

  // Scope the live preview to a single container instead of leaking the
  // partial theme onto :root globally. Same pattern as TokenPreview.vue.
  const previewEl = useTemplateRef<HTMLDivElement>('previewEl')
  watchEffect(() => {
    if (!previewEl.value) return
    try {
      const theme = createTheme({
        light: { colors: { primary: state.value.primaryColor } },
      })
      applyThemeToDOM(theme.light, previewEl.value)
    } catch (err) {
      console.warn('Failed to apply onboarding preview theme', err)
    }
  })

  async function submit() {
    if (!state.value.projectId) {
      error.value = t('onboarding.tokens.noProject')
      return
    }
    submitting.value = true
    error.value = null
    try {
      await $fetch(`/api/projects/${state.value.projectId}/config`, {
        method: 'POST',
        body: { colors: { primary: state.value.primaryColor } },
      })
      next()
    } catch (err) {
      error.value = (err as Error).message ?? t('onboarding.tokens.error')
    } finally {
      submitting.value = false
    }
  }
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="submit">
    <header class="flex flex-col gap-2">
      <h1 class="m-0">{{ t('onboarding.tokens.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('onboarding.tokens.subtitle') }}</p>
    </header>

    <div class="grid grid-cols-2 gap-6 items-start">
      <TokenColorField v-model="state.primaryColor" :label="t('tokens.color.primary')" />

      <ClientOnly>
        <div ref="previewEl" class="p-4 border rounded-lg bg-surface">
          <p class="text-tertiary text-sm mt-0">{{ t('onboarding.tokens.preview') }}</p>
          <div class="flex gap-3">
            <GTButton variant="primary">Primary</GTButton>
            <GTButton variant="secondary">Secondary</GTButton>
          </div>
        </div>
      </ClientOnly>
    </div>

    <GTAlert v-if="error" variant="error" :heading="error" />

    <div class="flex justify-between">
      <GTButton type="button" variant="secondary" :disabled="submitting" @click="back">
        {{ t('onboarding.back') }}
      </GTButton>
      <GTButton type="submit" :loading="submitting">
        {{ t('onboarding.continue') }}
      </GTButton>
    </div>
  </form>
</template>
