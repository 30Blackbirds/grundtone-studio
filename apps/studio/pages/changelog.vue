<script setup lang="ts">
  definePageMeta({ layout: 'app' })

  const { t } = useI18n()

  interface ChangelogResponse {
    source: string
    html: string
    markdown: string
  }

  const { data: studio } = await useAsyncData('changelog-studio', () =>
    $fetch<ChangelogResponse>('/api/changelog/studio'),
  )
  const { data: sdk } = await useAsyncData('changelog-sdk', () =>
    $fetch<ChangelogResponse>('/api/changelog/sdk'),
  )
</script>

<template>
  <section class="p-6">
    <header class="mb-6">
      <h1 class="m-0">{{ t('changelog.title') }}</h1>
      <p class="text-tertiary mt-2">{{ t('changelog.intro') }}</p>
    </header>

    <GTTabs
      :tabs="[
        { id: 'studio', label: t('changelog.studio') },
        { id: 'sdk', label: t('changelog.sdk') },
      ]"
    >
      <GTTabPanel id="studio">
        <article v-if="studio?.html" class="container-prose" v-html="studio.html" />
        <p v-else class="text-tertiary">{{ t('changelog.empty') }}</p>
      </GTTabPanel>

      <GTTabPanel id="sdk">
        <article v-if="sdk?.html" class="container-prose" v-html="sdk.html" />
        <p v-else class="text-tertiary">{{ t('changelog.empty') }}</p>
      </GTTabPanel>
    </GTTabs>
  </section>
</template>
