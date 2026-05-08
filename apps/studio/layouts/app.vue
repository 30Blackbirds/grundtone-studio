<script setup lang="ts">
  import { signOut, useSession } from '~~/lib/auth-client'

  const session = useSession()
  const { t } = useI18n()
  const { activeOrg } = useOrgContext()

  async function handleSignOut() {
    await signOut()
    await navigateTo('/login')
  }
</script>

<template>
  <div>
    <GTSkipLink href="#main">{{ t('skip.toContent') }}</GTSkipLink>
    <header class="flex justify-between items-center p-4 px-6 border-b bg-surface-raised">
      <div class="flex items-center gap-6">
        <NuxtLink to="/dashboard" class="brand-link">{{ t('app.name') }}</NuxtLink>
        <OrgSwitcher />
      </div>
      <div class="flex items-center gap-4">
        <LanguageSwitch />
        <span v-if="session.data?.user" class="text-tertiary text-sm">
          {{ session.data.user.email }}
        </span>
        <GTButton variant="tertiary" size="sm" @click="handleSignOut">
          {{ t('app.signOut') }}
        </GTButton>
      </div>
    </header>
    <div class="flex">
      <AppSidebar v-if="activeOrg" />
      <main id="main" class="flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>
