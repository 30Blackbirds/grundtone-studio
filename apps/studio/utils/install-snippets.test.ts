import { describe, it, expect } from 'vitest'
import { installSnippets, SPA_ONLY_MARKER } from './install-snippets'

const snippets = installSnippets({
  cdnBase: 'https://cdn.example.test',
  sampleKey: 'pk_live_<your-key>',
})

/** The part of a snippet before its single-page-app alternative, if any. */
const recommended = (code: string) => code.split(SPA_ONLY_MARKER)[0]

describe('integration guide: SSR frameworks get the brand in the server-rendered head', () => {
  it('Nuxt recommends a tokens.css link via useHead', () => {
    const code = recommended(snippets.nuxt)
    expect(code).toContain('useHead(')
    expect(code).toContain("rel: 'stylesheet'")
    expect(code).toContain(
      'https://cdn.example.test/k/${encodeURIComponent(grundtoneApiKey)}/tokens.css',
    )
  })

  it('Nuxt offers the client plugin only as the single-page-app alternative', () => {
    expect(snippets.nuxt).toContain(SPA_ONLY_MARKER)
    expect(recommended(snippets.nuxt)).not.toMatch(
      /grundtone\.client\.ts|defineNuxtPlugin|vueApp\.use/,
    )
    expect(snippets.nuxt.split(SPA_ONLY_MARKER)[1]).toContain('after JavaScript has run')
  })

  it('Next.js recommends a tokens.css link in the root layout, not the client loader', () => {
    expect(snippets.next).toContain('app/layout.tsx')
    expect(snippets.next).toContain(
      '<link rel="stylesheet" href={`https://cdn.example.test/k/${key}/tokens.css`} />',
    )
    expect(snippets.next).not.toContain('loadByApiKey')
  })

  it('the React snippet is for single-page apps and no longer points Next.js at the client loader', () => {
    expect(snippets.react).toContain('single-page app')
    expect(snippets.react).not.toMatch(/next\.?js|_app\.tsx/i)
  })

  it('points the script tags at the URLs /client serves: v1.js latest, v1.0.0.js pinned with SRI', () => {
    expect(snippets.scriptTag).toContain('<script src="https://cdn.example.test/client/v1.js"')
    expect(snippets.sri).toContain('src="https://cdn.example.test/client/v1.0.0.js"')
    expect(snippets.sri).toContain('https://cdn.example.test/client/v1.0.0.js.sri')
  })

  it('keeps the tokens.css link a <link>, never inlined as <style> (relative font URLs)', () => {
    for (const id of ['nuxt', 'next', 'scriptTag'] as const) {
      expect(snippets[id]).toContain('tokens.css')
      expect(snippets[id]).not.toContain('<style')
    }
  })
})
