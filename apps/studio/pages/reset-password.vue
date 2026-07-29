<script setup lang="ts">
  import { resetPassword } from '~~/lib/auth-client'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()

  const token = computed(() => (route.query.token as string | undefined) ?? null)
  const hasInvalidToken = computed(() => route.query.error === 'INVALID_TOKEN')
  const canReset = computed(() => Boolean(token.value) && !hasInvalidToken.value)

  const password = ref('')
  const confirmPassword = ref('')
  const pending = ref(false)
  const done = ref(false)
  const error = ref<string | null>(null)

  async function submit() {
    if (!token.value) return
    if (password.value !== confirmPassword.value) {
      error.value = t('auth.resetPassword.mismatch')
      return
    }
    pending.value = true
    error.value = null
    const res = await resetPassword({
      newPassword: password.value,
      token: token.value,
    })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('auth.resetPassword.error')
      return
    }
    done.value = true
    setTimeout(() => {
      navigateTo('/login?reset=success')
    }, 3000)
  }
</script>

<template>
  <AuthCard :title="t('auth.resetPassword.title')">
    <template v-if="hasInvalidToken || !token">
      <GTAlert variant="error" :heading="t('auth.resetPassword.invalidToken')" />
      <p class="mt-4">
        <NuxtLink to="/forgot-password">{{ t('auth.resetPassword.requestNewLink') }}</NuxtLink>
      </p>
    </template>

    <template v-else-if="done">
      <GTAlert variant="success" :heading="t('auth.resetPassword.success')" />
    </template>

    <template v-else-if="canReset">
      <p class="text-tertiary">{{ t('auth.resetPassword.body') }}</p>
      <form class="flex flex-col gap-4 mt-4" @submit.prevent="submit">
        <GTPasswordInput
          v-model="password"
          :label="t('auth.resetPassword.newPassword')"
          required
          autocomplete="new-password"
        />
        <GTPasswordInput
          v-model="confirmPassword"
          :label="t('auth.resetPassword.confirmPassword')"
          required
          autocomplete="new-password"
        />
        <GTAlert
          v-if="error"
          variant="error"
          :heading="error"
          :aria-label="t('auth.resetPassword.error')"
        />
        <GTButton type="submit" :loading="pending" block>{{
          t('auth.resetPassword.submit')
        }}</GTButton>
      </form>
    </template>

    <p class="mt-6 text-tertiary">
      <NuxtLink to="/login">{{ t('auth.forgotPassword.backToLogin') }}</NuxtLink>
    </p>
  </AuthCard>
</template>
