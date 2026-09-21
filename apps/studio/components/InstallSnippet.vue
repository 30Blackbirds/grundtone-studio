<script setup lang="ts">
  const props = defineProps<{ apiKey: string | null }>()
  const { t } = useI18n()

  const runtimeConfig = useRuntimeConfig()
  const cdnBase = computed(() => runtimeConfig.public.cdnBase || window.location.origin)

  const sampleKey = computed(() => props.apiKey ?? 'pk_live_<your-key>')

  // `</` + `script>` keeps the closing tag out of the SFC's surrounding <script> block.
  const closeTag = '</' + 'script>'
  const snippets = computed(() => ({
    scriptTag: `<script src="${cdnBase.value}/client/v1.js"
        data-api-key="${sampleKey.value}">${closeTag}
<link rel="stylesheet"
      href="${cdnBase.value}/k/${sampleKey.value}/tokens.css" />`,
    vuePlugin: `import { grundtone } from '@grundtone/saas-client'

app.use(grundtone, { apiKey: '${sampleKey.value}' })`,
    programmatic: `import { loadByApiKey } from '@grundtone/saas-client'

await loadByApiKey({ apiKey: '${sampleKey.value}' })`,
    curl: `curl ${cdnBase.value}/k/${sampleKey.value}/tokens.json`,
  }))

  const LANGUAGES: Record<string, string> = {
    scriptTag: 'html',
    vuePlugin: 'ts',
    programmatic: 'ts',
    curl: 'sh',
  }

  // 🔴 A FILENAME ONLY WHERE THE SNIPPET HAS ONE. The R7 prototype's bar shows
  // `nuxt.config.ts` — but next to a `loadByApiKey()` body, not the
  // `app.use(grundtone, …)` this tab renders, which lives in a Vue app's
  // `main.ts`. Copying the prototype's filename would label the code wrong.
  // The programmatic snippet belongs in any file and curl in a terminal, so
  // those two carry no filename rather than an invented one; the tab above
  // already names them.
  const FILENAMES: Record<string, string | undefined> = {
    scriptTag: 'index.html',
    vuePlugin: 'main.ts',
  }
</script>

<template>
  <section class="flex flex-col gap-4">
    <header>
      <h3 class="m-0">{{ t('install.title') }}</h3>
      <p class="text-tertiary text-sm mt-1">{{ t('install.intro') }}</p>
    </header>

    <GTAlert v-if="!apiKey" variant="warning" :heading="t('install.noKey')">
      {{ t('install.noKeyBody') }}
    </GTAlert>

    <!-- Tabbed per the R7 forlæg (redesign-r7-apikeys-install.html, UX-audit
         #12): one snippet pattern with variant tabs instead of a stacked
         wall — the reader picks their integration, the rest stays hidden. -->
    <GTTabs
      :tabs="
        Object.keys(snippets).map((id) => ({
          id,
          label: t(`install.${id}`),
        }))
      "
    >
      <GTTabPanel v-for="(code, id) in snippets" :id="id" :key="id">
        <!-- No `label`: it repeated the tab's own name one line below it. The
             bar carries the filename (when there is one) and the language. -->
        <CodeSnippet :code="code" :language="LANGUAGES[id] ?? 'txt'" :filename="FILENAMES[id]" />
      </GTTabPanel>
    </GTTabs>
  </section>
</template>
