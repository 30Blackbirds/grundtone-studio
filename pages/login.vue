<script setup lang="ts">
  import { signIn } from '~~/lib/auth-client'

  definePageMeta({ layout: 'auth' })

  const email = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const pending = ref(false)

  async function submit() {
    pending.value = true
    error.value = null
    const res = await signIn.email({ email: email.value, password: password.value })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? 'Login failed'
      return
    }
    await navigateTo('/dashboard')
  }
</script>

<template>
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">Sign in</h1>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <GTInput v-model="email" type="email" label="Email" required autocomplete="email" />
      <GTPasswordInput
        v-model="password"
        label="Password"
        required
        autocomplete="current-password"
      />
      <GTAlert v-if="error" variant="error" :heading="error" aria-label="Login error" />
      <GTButton type="submit" :loading="pending" block>Sign in</GTButton>
    </form>
    <p class="mt-6 text-tertiary">
      No account?
      <NuxtLink to="/signup">Sign up</NuxtLink>
    </p>
  </div>
</template>
