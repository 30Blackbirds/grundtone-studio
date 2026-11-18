<script setup lang="ts">
  import { signUp } from '~~/lib/auth-client'
  import { solveAltchaChallenge } from '~~/composables/useAltcha'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const authMode = useAuthMode()
  // Accounts are created at the identity provider; the first sign-in creates the Studio user.
  watch(authMode, (m) => m === 'oidc' && navigateTo('/login'), { immediate: true })
  const name = ref('')
  const email = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const pending = ref(false)

  async function submit() {
    pending.value = true
    error.value = null
    try {
      const captchaToken = await solveAltchaChallenge()
      const headers: Record<string, string> = {}
      if (captchaToken) headers['x-captcha-response'] = captchaToken

      const res = await signUp.email({
        email: email.value,
        password: password.value,
        name: name.value,
        callbackURL: '/dashboard',
        fetchOptions: { headers },
      })
      if (res.error) {
        error.value = res.error.message ?? t('auth.signup.error')
        return
      }
      await navigateTo(`/verify-email?email=${encodeURIComponent(email.value)}`)
    } catch {
      error.value = t('auth.captchaError')
    } finally {
      pending.value = false
    }
  }
</script>

<template>
  <AuthCard :title="t('auth.signup.title')">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <GTInput v-model="name" :label="t('auth.name')" required autocomplete="name" />
      <GTInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        required
        autocomplete="email"
      />
      <GTPasswordInput
        v-model="password"
        :label="t('auth.password')"
        required
        autocomplete="new-password"
      />
      <GTAlert v-if="error" variant="error" :heading="error" :aria-label="t('auth.signup.error')" />
      <GTButton type="submit" :loading="pending" block>{{ t('auth.signup.submit') }}</GTButton>
    </form>
    <p class="mt-4 mb-0 text-sm text-tertiary text-center">
      {{ t('auth.signup.haveAccount') }}
      <NuxtLink to="/login">{{ t('auth.signup.loginLink') }}</NuxtLink>
    </p>
  </AuthCard>
</template>
