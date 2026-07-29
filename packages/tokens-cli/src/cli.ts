#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import {
  applySets,
  pickTokensBase,
  resolveConfig,
  type ConfigFile,
  type ResolvedConfig,
} from './config.js'

function loadConfigFile(): ConfigFile | null {
  try {
    const raw = readFileSync(join(homedir(), '.grundtone', 'config.json'), 'utf8')
    return JSON.parse(raw) as ConfigFile
  } catch {
    return null
  }
}

async function api(cfg: ResolvedConfig, method: string, path: string, body?: unknown) {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}${text ? `: ${text}` : ''}`)
  }
  return text ? JSON.parse(text) : null
}

function configFor(projectId: string, globals: { apiBase?: string; key?: string }): ResolvedConfig {
  return resolveConfig({
    projectId,
    flags: { apiBase: globals.apiBase, key: globals.key },
    env: process.env,
    configFile: loadConfigFile(),
  })
}

const program = new Command()
program
  .name('grundtone-tokens')
  .description('Headless design-token management for Grundtone Studio projects')
  .version('0.0.0')
  .option('--api-base <url>', 'Studio API base URL (else GRUNDTONE_API_BASE or config file)')
  .option('--key <sk_key>', 'per-project secret key (else GRUNDTONE_TOKEN_KEY or config file)')

program
  .command('get <projectId>')
  .description("print the project's draft + active tokens as JSON")
  .action(async (projectId: string) => {
    const cfg = configFor(projectId, program.opts())
    const out = await api(cfg, 'GET', `/api/projects/${projectId}/config`)
    console.log(JSON.stringify(out, null, 2))
  })

program
  .command('set <projectId>')
  .description('save tokens as a draft (from a file and/or individual --set paths)')
  .option('--file <path>', 'read the full tokens object from a JSON file')
  .option(
    '--set <path=value...>',
    'set individual dot-paths, e.g. colors.primary=#0059b3 (repeatable)',
    [] as string[],
  )
  .action(async (projectId: string, opts: { file?: string; set: string[] }) => {
    const cfg = configFor(projectId, program.opts())

    let tokens: Record<string, unknown>
    if (opts.file) {
      tokens = JSON.parse(readFileSync(opts.file, 'utf8'))
    } else {
      // Start from the current draft's tokens, falling back to the active
      // version's tokens and finally the schema defaults — so `--set` tweaks
      // one slot without resending (or wiping) the rest.
      const current = await api(cfg, 'GET', `/api/projects/${projectId}/config`)
      tokens = pickTokensBase(current)
    }
    if (opts.set.length) tokens = applySets(tokens, opts.set)

    await api(cfg, 'POST', `/api/projects/${projectId}/config`, tokens)
    console.log(`✓ saved draft tokens for project ${projectId}`)
  })

program
  .command('publish <projectId>')
  .description('publish the current draft to the CDN')
  .action(async (projectId: string) => {
    const cfg = configFor(projectId, program.opts())
    const res = await api(cfg, 'POST', `/api/projects/${projectId}/publish`, {})
    console.log(`✓ published version ${res?.version ?? '?'} for project ${projectId}`)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
