<script setup lang="ts">
  import { signOut, useSession } from '~~/lib/auth-client'

  const session = useSession()

  async function handleSignOut() {
    await signOut()
    await navigateTo('/login')
  }
</script>

<template>
  <div class="app-layout">
    <header class="top-bar">
      <NuxtLink to="/dashboard" class="brand">Grundtone Studio</NuxtLink>
      <div class="user">
        <span v-if="session.data?.user" class="muted">{{ session.data.user.email }}</span>
        <button @click="handleSignOut">Sign out</button>
      </div>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
