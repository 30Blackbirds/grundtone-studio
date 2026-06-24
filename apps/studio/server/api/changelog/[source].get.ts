import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { marked, Renderer } from 'marked'

// Map URL-safe source IDs to repo-relative file paths. Resolved from
// process.cwd() in dev (apps/studio/) and from /app in the prod Dockerfile
// (we copy both CHANGELOG.md files into the runtime image at build time).
const SOURCES = {
  studio: 'CHANGELOG.md',
  sdk: 'packages/saas-client/CHANGELOG.md',
} as const

type Source = keyof typeof SOURCES

function resolveSource(source: Source): string[] {
  return [resolve(process.cwd(), '../..', SOURCES[source]), resolve(process.cwd(), SOURCES[source])]
}

// Renderer that maps standard markdown elements to grundtone utility classes
// so the rendered changelog inherits the design system without any ad-hoc CSS.
const renderer = new Renderer()
const HEADING_SIZES = ['', '3xl', '2xl', 'xl', 'lg', 'base', 'sm']
renderer.heading = ({ tokens, depth }) => {
  const text = renderer.parser.parseInline(tokens)
  const size = HEADING_SIZES[depth] ?? 'base'
  return `<h${depth} class="font-heading text-${size} font-bold mt-6 mb-3">${text}</h${depth}>`
}
renderer.paragraph = ({ tokens }) =>
  `<p class="font-base text-base leading-relaxed mb-3">${renderer.parser.parseInline(tokens)}</p>`
renderer.list = ({ items, ordered }) => {
  const tag = ordered ? 'ol' : 'ul'
  const body = items.map((item) => renderer.listitem(item)).join('')
  return `<${tag} class="font-base text-base leading-relaxed pl-6 mb-3">${body}</${tag}>`
}
renderer.listitem = ({ tokens }) => `<li class="mb-1">${renderer.parser.parse(tokens)}</li>`
renderer.codespan = ({ text }) =>
  `<code class="font-mono text-sm bg-surface rounded-sm">${text}</code>`
renderer.link = ({ href, tokens }) =>
  `<a href="${href}" class="text-primary">${renderer.parser.parseInline(tokens)}</a>`
renderer.hr = () => `<hr class="my-6 border-t" />`

defineRouteMeta({
  openAPI: {
    summary:
      'Henter CHANGELOG.md (studio eller sdk) og returnerer renderet HTML + rå markdown til changelog-siden.',
    description:
      'Læser CHANGELOG.md for den valgte kilde (studio eller sdk) og returnerer både renderet HTML og rå markdown til changelog-siden.',
    tags: ['System'],
  },
})

export default defineEventHandler(async (event) => {
  const source = getRouterParam(event, 'source') as Source | undefined
  if (!source || !(source in SOURCES)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown changelog source' })
  }

  for (const path of resolveSource(source)) {
    try {
      const md = await readFile(path, 'utf-8')
      setHeader(event, 'Cache-Control', 'public, max-age=300, must-revalidate')
      return { source, html: await marked.parse(md, { renderer }), markdown: md }
    } catch {
      continue
    }
  }

  return { source, html: '', markdown: '' }
})
