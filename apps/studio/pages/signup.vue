<script setup lang="ts">
  import { signUp } from '~~/lib/auth-client'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const name = ref('')
  const email = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const pending = ref(false)

  async function submit() {
    pending.value = true
    error.value = null
    const res = await signUp.email({
      email: email.value,
      password: password.value,
      name: name.value,
    })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('auth.signup.error')
      return
    }
    await navigateTo('/dashboard')
  }
</script>

<template>
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">{{ t('auth.signup.title') }}</h1>
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
    <p class="mt-6 text-tertiary">
      {{ t('auth.signup.haveAccount') }}
      <NuxtLink to="/login">{{ t('auth.signup.loginLink') }}</NuxtLink>
    </p>
  </div>
</template>
