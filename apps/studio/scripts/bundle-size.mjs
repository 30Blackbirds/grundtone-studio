#!/usr/bin/env node
// Bundle size checker. Walks the Nuxt build output (.output/) after a
// production build, sums file sizes per bucket (public client / server),
// and fails if any bucket exceeds its budget in `.size-limit.json`.
//
// Intentionally simple — no extra dependency. If we ever need gzip /
// brotli reporting per chunk, switch to `size-limit` proper.

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const STUDIO = resolve(import.meta.dirname, '..')
const OUTPUT = resolve(STUDIO, '.output')
const CONFIG = resolve(STUDIO, '.size-limit.json')

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

async function bucketSize(root, filter) {
  let total = 0
  for await (const file of walk(root)) {
    if (filter && !filter(file)) continue
    const s = await stat(file)
    total += s.size
  }
  return total
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}

async function main() {
  const configRaw = await readFile(CONFIG, 'utf-8')
  const config = JSON.parse(configRaw)

  const results = []
  let failed = false

  for (const bucket of config.buckets) {
    const root = resolve(STUDIO, bucket.path)
    // Strings in include/exclude are substring matches; null = take all.
    const filter = (file) => {
      if (bucket.exclude?.some((s) => file.includes(s))) return false
      if (bucket.include?.length && !bucket.include.some((s) => file.includes(s))) return false
      return true
    }
    const size = await bucketSize(root, filter)
    const overBudget = bucket.maxBytes > 0 && size > bucket.maxBytes
    if (overBudget) failed = true
    results.push({ name: bucket.name, size, max: bucket.maxBytes, overBudget })
  }

  const widest = Math.max(...results.map((r) => r.name.length), 8)
  console.log('Bundle sizes:')
  for (const r of results) {
    const mark = r.overBudget ? '✗' : '✓'
    const pct = r.max > 0 ? `${((r.size / r.max) * 100).toFixed(0)}%` : '—'
    console.log(
      `  ${mark} ${r.name.padEnd(widest)}  ${fmt(r.size).padStart(10)}  / ${fmt(r.max).padStart(10)}  (${pct})`,
    )
  }
  if (failed) {
    console.error('\n✗ One or more buckets exceeded their budget.')
    console.error(
      '  Bump the threshold in .size-limit.json (with rationale in the PR) OR shrink the bundle.',
    )
    process.exit(1)
  }
}

await main()
