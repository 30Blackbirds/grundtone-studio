<script setup lang="ts">
  import { signIn } from '~~/lib/auth-client'
  import { executeRecaptcha } from '~~/composables/useRecaptcha'

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
    const captchaToken = await executeRecaptcha('login')
    const headers: Record<string, string> = {}
    if (captchaToken) headers['x-captcha-response'] = captchaToken

    const res = await signIn.email({
      email: email.value,
      password: password.value,
      fetchOptions: { headers },
    })
    pending.value = false
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
  }
</script>

<template>
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">{{ t('auth.login.title') }}</h1>

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
  </div>
</template>
