<script setup lang="ts">
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  const runtimeConfig = useRuntimeConfig()
  const cdnBase = computed(() => runtimeConfig.public.cdnBase || 'https://cdn.grundtone.io')
  const sampleKey = 'pk_live_<your-key>'

  // Concatenate `<` + `/script>` so the literal closing tag doesn't appear in
  // this SFC's <script> block (which would terminate it). Same reason \/script
  // would normally be used, but ESLint's no-useless-escape flags the backslash.
  const closeScript = '<' + '/script>'

  const snippets = computed(() => ({
    scriptTag: `<script src="${cdnBase.value}/client/v1.js"
        data-api-key="${sampleKey}">${closeScript}
<link rel="stylesheet"
      href="${cdnBase.value}/k/${sampleKey}/tokens.css" />`,
    vue: `// main.ts
import { createApp } from 'vue'
import { grundtone } from '@grundtone/saas-client'
import App from './App.vue'

createApp(App)
  .use(grundtone, { apiKey: '${sampleKey}' })
  .mount('#app')`,
    nuxt: `// plugins/grundtone.client.ts
import { grundtone } from '@grundtone/saas-client'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(grundtone, {
    apiKey: useRuntimeConfig().public.grundtoneApiKey,
  })
})`,
    react: `// src/main.tsx (or _app.tsx for Next.js)
import { loadByApiKey } from '@grundtone/saas-client'

loadByApiKey({ apiKey: '${sampleKey}' })
  .catch((err) => console.warn('grundtone init failed', err))

// then render your app — components inherit the CSS variables
// from :root automatically`,
    svelte: `// src/app.ts
import { loadByApiKey } from '@grundtone/saas-client'

loadByApiKey({ apiKey: '${sampleKey}' })`,
  }))

  type SnippetId = 'scriptTag' | 'vue' | 'nuxt' | 'react' | 'svelte'
  const tabs: Array<{ id: SnippetId; label: string; language: string }> = [
    { id: 'scriptTag', label: t('integrationGuide.scriptTag'), language: 'html' },
    { id: 'vue', label: 'Vue 3', language: 'ts' },
    { id: 'nuxt', label: 'Nuxt 3', language: 'ts' },
    { id: 'react', label: 'React / Next.js', language: 'tsx' },
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

    <GTTabs :tabs="tabs.map((tab) => ({ id: tab.id, label: tab.label }))">
      <GTTabPanel v-for="tab in tabs" :id="tab.id" :key="tab.id">
        <pre
          class="m-0 p-3 bg-surface border rounded font-mono text-sm overflow-x-auto"
        ><code>{{ snippets[tab.id] }}</code></pre>
      </GTTabPanel>
    </GTTabs>

    <section class="flex flex-col gap-3">
      <h2 class="font-heading text-2xl mt-6 mb-1">{{ t('integrationGuide.sriHeading') }}</h2>
      <p>{{ t('integrationGuide.sriBody') }}</p>
      <pre
        class="m-0 p-3 bg-surface border rounded font-mono text-sm overflow-x-auto"
      ><code>&lt;script
  src="{{ cdnBase }}/client/v1.0.0.js"
  integrity="sha384-&lt;hash from cdn.grundtone.io/client/v1.0.0.js.sri&gt;"
  crossorigin="anonymous"
  data-api-key="{{ sampleKey }}"&gt;&lt;/script&gt;</code></pre>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="font-heading text-2xl mt-6 mb-1">{{ t('integrationGuide.modeHeading') }}</h2>
      <p>{{ t('integrationGuide.modeBody') }}</p>
      <pre
        class="m-0 p-3 bg-surface border rounded font-mono text-sm overflow-x-auto"
      ><code>app.use(grundtone, {
  apiKey: '{{ sampleKey }}',
  mode: 'auto',  // 'light' | 'dark' | 'auto' (follows prefers-color-scheme)
})</code></pre>
    </section>
  </article>
</template>
