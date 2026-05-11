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

  const copyState = ref<Record<string, 'idle' | 'copied'>>({})

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text)
    copyState.value[id] = 'copied'
    setTimeout(() => (copyState.value[id] = 'idle'), 1500)
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

    <div v-for="(code, id) in snippets" :key="id" class="flex flex-col gap-2">
      <div class="flex justify-between items-center">
        <strong class="text-sm">{{ t(`install.${id}`) }}</strong>
        <GTButton variant="outlined" size="sm" @click="copy(id, code)">
          {{ copyState[id] === 'copied' ? t('apiKeys.copied') : t('apiKeys.copy') }}
        </GTButton>
      </div>
      <pre
        class="m-0 p-3 bg-surface border rounded font-mono text-sm overflow-x-auto"
      ><code>{{ code }}</code></pre>
    </div>
  </section>
</template>
