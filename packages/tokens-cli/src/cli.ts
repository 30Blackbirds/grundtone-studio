#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import {
  applySets,
  pickTokensBase,
  resolveConfig,
  type ConfigFile,
  type ResolvedConfig,
} from './config.js'
import {
  importBody,
  importExitCode,
  importPath,
  importReportLines,
  parseTokenFile,
  type ImportResponse,
} from './import.js'
import {
  checkExportOptions,
  exportPath,
  filesToFetch,
  reportLines,
  type ExportReportResponse,
} from './export.js'

function loadConfigFile(): ConfigFile | null {
  try {
    const raw = readFileSync(join(homedir(), '.grundtone', 'config.json'), 'utf8')
    return JSON.parse(raw) as ConfigFile
  } catch {
    return null
  }
}

async function request(cfg: ResolvedConfig, method: string, path: string, body?: unknown) {
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
  return text
}

async function api(cfg: ResolvedConfig, method: string, path: string, body?: unknown) {
  const text = await request(cfg, method, path, body)
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

program
  .command('export <projectId>')
  .description('download the tokens as DTCG 2025.10 files (base, and dark + resolver if set)')
  .requiredOption('--format <format>', 'export format (dtcg)')
  .requiredOption('--source <source>', 'draft or active')
  .option('--out <dir>', 'directory to write the files to', '.')
  .action(async (projectId: string, opts: { format: string; source: string; out: string }) => {
    const source = checkExportOptions(opts)
    const cfg = configFor(projectId, program.opts())
    const res = (await api(
      cfg,
      'GET',
      exportPath(projectId, source, 'report'),
    )) as ExportReportResponse
    const outDir = resolve(opts.out)
    mkdirSync(outDir, { recursive: true })
    for (const file of filesToFetch(res)) {
      const content = await request(cfg, 'GET', exportPath(projectId, source, file.part))
      writeFileSync(join(outDir, file.name), content)
      console.log(`✓ wrote ${join(outDir, file.name)}`)
    }
    for (const line of reportLines(res)) console.log(line)
  })

program
  .command('import <projectId>')
  .description('import a DTCG 2025.10 file as a DRAFT (never publishes)')
  .requiredOption('--file <path>', 'the base tokens file')
  .option('--dark <path>', 'a second file to import as the dark theme')
  .option('--dry-run', 'print the report and write nothing', false)
  .action(async (projectId: string, opts: { file: string; dark?: string; dryRun: boolean }) => {
    const cfg = configFor(projectId, program.opts())
    const base = parseTokenFile('base', opts.file, readFileSync(opts.file, 'utf8'))
    const dark = opts.dark
      ? parseTokenFile('dark', opts.dark, readFileSync(opts.dark, 'utf8'))
      : undefined

    const res = (await api(
      cfg,
      'POST',
      importPath(projectId),
      importBody(base, dark, opts.dryRun),
    )) as ImportResponse

    for (const line of importReportLines(res, opts.dryRun)) console.log(line)
    // 🔴 The report is printed BEFORE the exit code is applied: a non-zero exit
    // after a successful write means "saved, and here is what I refused", and
    // that is unreadable if the reasons never reach the log.
    const code = importExitCode(res.report, opts.dryRun)
    if (code !== 0) process.exitCode = code
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
