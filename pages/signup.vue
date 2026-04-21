<script setup lang="ts">
import { signUp } from '~~/lib/auth-client'

definePageMeta({ layout: 'auth' })

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
    error.value = res.error.message ?? 'Sign-up failed'
    return
  }
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="auth-card">
    <h1>Create account</h1>
    <form @submit.prevent="submit">
      <label>
        Name
        <input v-model="name" type="text" required autocomplete="name" />
      </label>
      <label>
        Email
        <input v-model="email" type="email" required autocomplete="email" />
      </label>
      <label>
        Password
        <input v-model="password" type="password" required autocomplete="new-password" minlength="8" />
      </label>
      <button type="submit" :disabled="pending">{{ pending ? 'Creating…' : 'Create account' }}</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <p class="muted">Already have an account? <NuxtLink to="/login">Sign in</NuxtLink></p>
  </div>
</template>
