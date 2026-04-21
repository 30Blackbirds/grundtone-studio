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
  const res = await signIn.email({
    email: email.value,
    password: password.value,
  })
  pending.value = false
  if (res.error) {
    error.value = res.error.message ?? 'Login failed'
    return
  }
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="auth-card">
    <h1>Sign in</h1>
    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" required autocomplete="email" />
      </label>
      <label>
        Password
        <input v-model="password" type="password" required autocomplete="current-password" />
      </label>
      <button type="submit" :disabled="pending">{{ pending ? 'Signing in…' : 'Sign in' }}</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <p class="muted">No account? <NuxtLink to="/signup">Sign up</NuxtLink></p>
  </div>
</template>
