<script setup lang="ts">
  import { signOut, useSession } from '~~/lib/auth-client'

  const session = useSession()

  async function handleSignOut() {
    await signOut()
    await navigateTo('/login')
  }
</script>

<template>
  <div>
    <header class="flex justify-between items-center p-4 px-6 border-b bg-surface-raised">
      <NuxtLink to="/dashboard" class="brand-link">Grundtone Studio</NuxtLink>
      <div class="flex items-center gap-4">
        <span v-if="session.data?.user" class="text-tertiary text-sm">
          {{ session.data.user.email }}
        </span>
        <GTButton variant="tertiary" size="sm" @click="handleSignOut">Sign out</GTButton>
      </div>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
