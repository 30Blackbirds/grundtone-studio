// Code snippets for the public integration guide (/docs/install). Kept out of
// the page so the recommendation itself is unit-testable (riff
// li86nl1t62ayqy3q21vcck8y, AC-A5 from KH-981).
//
// SSR frameworks get the brand from a <link rel="stylesheet"> to
// /k/{key}/tokens.css in the server-rendered <head>: the tenant's CSS
// variables are then in place before first paint, with no client JavaScript.
// That is how Etude does it (server/plugins/brand-tokens.ts). The client
// plugin applies the brand only after JavaScript has run, so it is offered
// for single-page apps only.
//
// The link must stay a <link>: the @font-face URLs inside tokens.css are
// relative and resolve against /k/{key}/, which an inlined <style> breaks.

import { SDK_CONTRACT_MAJOR, SDK_CONTRACT_VERSION } from './sdk-contract'

export interface InstallSnippetInput {
  cdnBase: string
  sampleKey: string
}

export type InstallSnippetId = 'scriptTag' | 'vue' | 'nuxt' | 'next' | 'react' | 'svelte'

/** Marks where a snippet's single-page-app alternative starts. */
export const SPA_ONLY_MARKER = 'SPA only'

export function installSnippets({
  cdnBase,
  sampleKey,
}: InstallSnippetInput): Record<InstallSnippetId, string> & { sri: string; mode: string } {
  return {
    scriptTag: `<script src="${cdnBase}/client/v${SDK_CONTRACT_MAJOR}.js"
        data-api-key="${sampleKey}"></script>
<link rel="stylesheet"
      href="${cdnBase}/k/${sampleKey}/tokens.css" />`,
    vue: `// main.ts
import { createApp } from 'vue'
import { grundtone } from '@grundtone/saas-client'
import App from './App.vue'

createApp(App)
  .use(grundtone, { apiKey: '${sampleKey}' })
  .mount('#app')`,
    nuxt: `<!-- app.vue — rendered on the server, so the stylesheet is in the
     server-rendered <head> and the brand is there before first paint -->
<script setup lang="ts">
const { grundtoneApiKey } = useRuntimeConfig().public

useHead({
  link: [
    {
      rel: 'stylesheet',
      href: \`${cdnBase}/k/\${encodeURIComponent(grundtoneApiKey)}/tokens.css\`,
    },
  ],
})
</script>

<!-- ${SPA_ONLY_MARKER} (ssr: false): a client plugin in plugins/grundtone.client.ts
     with nuxtApp.vueApp.use(grundtone, { apiKey }) also works, but the
     brand then arrives only after JavaScript has run. -->`,
    next: `// app/layout.tsx — rendered on the server, so the stylesheet is in the
// server-rendered <head> and the brand is there before first paint
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const key = encodeURIComponent(process.env.NEXT_PUBLIC_GRUNDTONE_API_KEY ?? '')
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href={\`${cdnBase}/k/\${key}/tokens.css\`} />
      </head>
      <body>{children}</body>
    </html>
  )
}`,
    react: `// src/main.tsx — single-page app
import { loadByApiKey } from '@grundtone/saas-client'

loadByApiKey({ apiKey: '${sampleKey}' })
  .catch((err) => console.warn('grundtone init failed', err))

// then render your app — components inherit the CSS variables
// from :root automatically`,
    svelte: `// src/app.ts
import { loadByApiKey } from '@grundtone/saas-client'

loadByApiKey({ apiKey: '${sampleKey}' })`,
    sri: `<script
  src="${cdnBase}/client/v${SDK_CONTRACT_VERSION}.js"
  integrity="sha384-<hash from ${cdnBase}/client/v${SDK_CONTRACT_VERSION}.js.sri>"
  crossorigin="anonymous"
  data-api-key="${sampleKey}"></script>`,
    mode: `app.use(grundtone, {
  apiKey: '${sampleKey}',
  mode: 'auto',  // 'light' | 'dark' | 'auto' (follows prefers-color-scheme)
})`,
  }
}
