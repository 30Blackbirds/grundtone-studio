import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// 🔴 THE REASON THIS FILE EXISTS: studio#298 cured this shape on ONE component
// and left it in two others. Nobody noticed for three weeks, because the cure
// was applied where a designer happened to look rather than everywhere the
// shape occurs. A count is only worth having if something keeps counting.
//
// The shape: a flex row with `justify-between` and card padding — an info
// column on the left, actions on the right. Its first child defaults to
// `min-width: auto`, refuses to shrink below an email address, and pushes the
// actions off screen. `.card-row` is the shared treatment.
//
// WHAT IT READS, AND THEREFORE WHAT IT CANNOT SEE: it greps class strings. A
// row built from a computed class, or one that expresses the same shape with
// different utilities, is outside this denominator entirely — so the "7" this
// guard protects is a count of literal `flex … justify-between … p-4` class
// strings, not a count of card rows in the product. Vitest does no layout, so
// it cannot check that anything actually fits; that acceptance is the browser
// measurement in the commit.

const APP = fileURLToPath(new URL('../', import.meta.url))
const DIRS = ['pages', 'components']

function vueFiles(): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const full = join(d, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (e.endsWith('.vue')) out.push(full)
    }
  }
  for (const d of DIRS) walk(join(APP, d))
  return out
}

/** A card row: flex + justify-between + card padding, on one class attribute. */
function cardRowClassAttrs(src: string): string[] {
  return [...src.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1]!)
    .filter((c) => /\bflex\b/.test(c) && /\bjustify-between\b/.test(c) && /\bp-4\b/.test(c))
}

describe('every card row of this shape carries the shared treatment', () => {
  it('finds rows at all (the denominator is not zero)', () => {
    const total = vueFiles().reduce(
      (n, f) => n + cardRowClassAttrs(readFileSync(f, 'utf8')).length,
      0,
    )
    expect(vueFiles().length, 'no .vue files scanned — the reader is broken').toBeGreaterThan(20)
    expect(total, 'no card rows found — the pattern is broken').toBeGreaterThanOrEqual(7)
  })

  it('none is missing .card-row or an equivalent min-w-0 on its info column', () => {
    const missing: string[] = []
    for (const file of vueFiles()) {
      const src = readFileSync(file, 'utf8')
      for (const attr of cardRowClassAttrs(src)) {
        // ApiKeyManager cured its rows in #298 by putting min-w-0 directly on
        // the info column. That is the same fix, written out, so it counts —
        // this guard is about the shape being TREATED, not about the class name.
        const treated = /\bcard-row\b/.test(attr) || src.includes('min-w-0')
        if (!treated) missing.push(`${file.replace(APP, '')}: class="${attr.slice(0, 60)}…"`)
      }
    }
    expect(
      missing,
      `card row(s) with no min-width treatment — the info column will push the ` +
        `actions off screen at 375:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })
})
