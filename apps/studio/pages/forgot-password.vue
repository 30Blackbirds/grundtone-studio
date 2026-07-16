<script setup lang="ts">
  import { authClient } from '~~/lib/auth-client'
  import { solveAltchaChallenge } from '~~/composables/useAltcha'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const config = useRuntimeConfig()
  const email = ref('')
  const pending = ref(false)
  const sent = ref(false)
  const error = ref<string | null>(null)

  async function submit() {
    pending.value = true
    error.value = null
    try {
      const captchaToken = await solveAltchaChallenge()
      const headers: Record<string, string> = {}
      if (captchaToken) headers['x-captcha-response'] = captchaToken

      const redirectTo = `${config.public.appUrl || window.location.origin}/reset-password`
      const res = await authClient.requestPasswordReset({
        email: email.value,
        redirectTo,
        fetchOptions: { headers },
      })
      if (res.error) {
        error.value = res.error.message ?? t('auth.forgotPassword.error')
        return
      }
      sent.value = true
    } catch {
      error.value = t('auth.captchaError')
    } finally {
      pending.value = false
    }
  }
</script>

<template>
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">{{ t('auth.forgotPassword.title') }}</h1>
    <p class="text-tertiary">{{ t('auth.forgotPassword.body') }}</p>

    <GTAlert v-if="sent" variant="success" :heading="t('auth.forgotPassword.sent')" />

    <form v-else class="flex flex-col gap-4 mt-4" @submit.prevent="submit">
      <GTInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        required
        autocomplete="email"
      />
      <GTAlert
        v-if="error"
        variant="error"
        :heading="error"
        :aria-label="t('auth.forgotPassword.error')"
      />
      <GTButton type="submit" :loading="pending" block>{{
        t('auth.forgotPassword.submit')
      }}</GTButton>
    </form>

    <p class="mt-6 text-tertiary">
      <NuxtLink to="/login">{{ t('auth.forgotPassword.backToLogin') }}</NuxtLink>
    </p>
  </div>
</template>
