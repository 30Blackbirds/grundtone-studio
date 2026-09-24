<script setup lang="ts">
  import { installSnippets, type InstallSnippetId } from '~~/utils/install-snippets'

  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  // One source with the in-app snippet (KH-1178). The production host is NOT
  // spelled out here any more: prod refuses to boot without an explicit
  // cdnBase, so the fallback inside is only ever a dev/self-host value.
  const cdnBase = useCdnBase()
  const sampleKey = 'pk_live_<your-key>'

  // The snippets live in utils/install-snippets.ts so the recommendation (SSR
  // frameworks link tokens.css in the server-rendered head) is unit-tested.
  const snippets = computed(() => installSnippets({ cdnBase: cdnBase.value, sampleKey }))

  const tabs: Array<{ id: InstallSnippetId; label: string; language: string }> = [
    { id: 'scriptTag', label: t('integrationGuide.scriptTag'), language: 'html' },
    { id: 'vue', label: 'Vue 3', language: 'ts' },
    { id: 'nuxt', label: 'Nuxt', language: 'vue' },
    { id: 'next', label: 'Next.js', language: 'tsx' },
    { id: 'react', label: 'React (SPA)', language: 'tsx' },
    { id: 'svelte', label: 'Svelte', language: 'ts' },
  ]
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-6">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('integrationGuide.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('integrationGuide.intro') }}</p>
    </header>

    <GTAlert variant="info" :heading="t('integrationGuide.keyNoticeHeading')">
      {{ t('integrationGuide.keyNoticeBody') }}
      <NuxtLink to="/dashboard" class="text-primary">{{
        t('integrationGuide.keyNoticeLink')
      }}</NuxtLink>
    </GTAlert>

    <GTAlert variant="info" :heading="t('integrationGuide.ssrHeading')">
      {{ t('integrationGuide.ssrBody') }}
    </GTAlert>

    <GTTabs :tabs="tabs.map((tab) => ({ id: tab.id, label: tab.label }))">
      <GTTabPanel v-for="tab in tabs" :id="tab.id" :key="tab.id">
        <CodeSnippet :code="snippets[tab.id]" :language="tab.language" />
      </GTTabPanel>
    </GTTabs>

    <section class="flex flex-col gap-3">
      <h2 class="font-heading text-2xl mt-6 mb-1">{{ t('integrationGuide.sriHeading') }}</h2>
      <p>{{ t('integrationGuide.sriBody') }}</p>
      <CodeSnippet :code="snippets.sri" language="html" />
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="font-heading text-2xl mt-6 mb-1">{{ t('integrationGuide.modeHeading') }}</h2>
      <p>{{ t('integrationGuide.modeBody') }}</p>
      <CodeSnippet :code="snippets.mode" language="ts" />
    </section>
  </article>
</template>
