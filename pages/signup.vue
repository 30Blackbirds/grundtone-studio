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
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">Create account</h1>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <GTInput v-model="name" label="Name" required autocomplete="name" />
      <GTInput v-model="email" type="email" label="Email" required autocomplete="email" />
      <GTPasswordInput
        v-model="password"
        label="Password"
        required
        autocomplete="new-password"
        help-text="Minimum 8 characters"
      />
      <GTAlert v-if="error" variant="error" :heading="error" aria-label="Sign-up error" />
      <GTButton type="submit" :loading="pending" block>Create account</GTButton>
    </form>
    <p class="mt-6 text-tertiary">
      Already have an account?
      <NuxtLink to="/login">Sign in</NuxtLink>
    </p>
  </div>
</template>
