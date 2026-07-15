<script setup lang="ts">
  import { useSession } from '~~/lib/auth-client'

  definePageMeta({ layout: 'app' })

  const session = useSession()
  const { t } = useI18n()

  const tabs = computed(() => [
    { id: 'profile', label: t('account.tabs.profile') },
    { id: 'security', label: t('account.tabs.security') },
    { id: 'organizations', label: t('account.tabs.organizations') },
    { id: 'privacy', label: t('account.tabs.privacy') },
  ])
</script>

<template>
  <section class="p-6 max-w-3xl">
    <header class="mb-6">
      <h1 class="m-0">{{ t('account.title') }}</h1>
      <p v-if="session.data?.user?.email" class="text-tertiary mt-2 mb-0">
        {{ session.data.user.email }}
      </p>
    </header>

    <AccountVerificationBanner class="mb-6" />

    <GTTabs :tabs="tabs">
      <GTTabPanel id="profile">
        <GTCard :title="t('account.tabs.profile')">
          <AccountProfileForm />
          <hr class="my-6" />
          <AccountEmailForm />
        </GTCard>
      </GTTabPanel>

      <GTTabPanel id="security">
        <GTCard :title="t('account.tabs.security')">
          <AccountPasswordForm />
        </GTCard>
      </GTTabPanel>

      <GTTabPanel id="organizations">
        <GTCard :title="t('account.tabs.organizations')">
          <AccountOrganizationsList />
        </GTCard>
      </GTTabPanel>

      <GTTabPanel id="privacy">
        <GTCard :title="t('account.privacy.export')" class="mb-6">
          <AccountDataExport />
        </GTCard>
        <AccountDeleteSection />
      </GTTabPanel>
    </GTTabs>
  </section>
</template>
