<script setup lang="ts">
  import { signIn } from '~~/lib/auth-client'
  import { solveAltchaChallenge } from '~~/composables/useAltcha'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()
  const email = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const pending = ref(false)

  const redirect = computed(() => (route.query.redirect as string) || '/dashboard')
  const resetSuccess = computed(() => route.query.reset === 'success')

  async function submit() {
    pending.value = true
    error.value = null
    try {
      const captchaToken = await solveAltchaChallenge()
      const headers: Record<string, string> = {}
      if (captchaToken) headers['x-captcha-response'] = captchaToken

      const res = await signIn.email({
        email: email.value,
        password: password.value,
        fetchOptions: { headers },
      })
      if (res.error) {
        const code = (res.error as { code?: string }).code
        if (code === 'EMAIL_NOT_VERIFIED') {
          await navigateTo(`/verify-email?email=${encodeURIComponent(email.value)}`)
          return
        }
        error.value = res.error.message ?? t('auth.login.error')
        return
      }
      await navigateTo(redirect.value)
    } catch {
      error.value = t('auth.captchaError')
    } finally {
      pending.value = false
    }
  }
</script>

<template>
  <AuthCard :title="t('auth.login.title')">
    <GTAlert
      v-if="resetSuccess"
      variant="success"
      :heading="t('auth.login.resetSuccess')"
      class="mb-4"
    />

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <GTInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        required
        autocomplete="email"
      />
      <div class="flex flex-col gap-1">
        <GTPasswordInput
          v-model="password"
          :label="t('auth.password')"
          required
          autocomplete="current-password"
        />
        <NuxtLink to="/forgot-password" class="text-sm text-tertiary">
          {{ t('auth.login.forgotPassword') }}
        </NuxtLink>
      </div>
      <GTAlert v-if="error" variant="error" :heading="error" :aria-label="t('auth.login.error')" />
      <GTButton type="submit" :loading="pending" block>{{ t('auth.login.submit') }}</GTButton>
    </form>
    <p class="mt-6 text-tertiary">
      {{ t('auth.login.noAccount') }}
      <NuxtLink to="/signup">{{ t('auth.login.createAccount') }}</NuxtLink>
    </p>
  </AuthCard>
</template>
