<script setup lang="ts">
  import { signIn } from '~~/lib/auth-client'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const email = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const pending = ref(false)

  const route = useRoute()
  const redirect = computed(() => (route.query.redirect as string) || '/dashboard')

  async function submit() {
    pending.value = true
    error.value = null
    const res = await signIn.email({ email: email.value, password: password.value })
    pending.value = false
    if (res.error) {
      // Better Auth flags pending verification with code EMAIL_NOT_VERIFIED;
      // bounce the user to the inbox-check page (and pre-fill the resend
      // form) instead of leaving them stuck on a generic login error.
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
    <form class="flex flex-col gap-4" @submit.prevent="submit">
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
        autocomplete="current-password"
      />
      <GTAlert v-if="error" variant="error" :heading="error" :aria-label="t('auth.login.error')" />
      <GTButton type="submit" :loading="pending" block>{{ t('auth.login.submit') }}</GTButton>
    </form>
    <p class="mt-6 text-tertiary">
      {{ t('auth.login.noAccount') }}
      <NuxtLink to="/signup">{{ t('auth.login.createAccount') }}</NuxtLink>
    </p>
  </div>
</template>
