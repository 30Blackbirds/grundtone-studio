// Liveness probe — fast, no auth, no DB. Deploy workflows poll this after
// `docker compose up -d` to confirm the new image is serving requests.
//
// Don't extend this with DB/storage checks; those belong on /readyz so a slow
// dependency doesn't take the container out of rotation while it self-heals.

defineRouteMeta({
  openAPI: {
    summary:
      'Liveness-probe uden auth/DB; returnerer status, version og uptime til deploy-/compose-healthchecks.',
    description:
      'Hurtig liveness-probe uden auth eller DB-opslag. Returnerer status, version og uptime og bruges af deploy- og compose-healthchecks.',
    tags: ['System'],
  },
})

export default defineEventHandler(() => {
  return {
    status: 'ok',
    service: 'grundtone-studio',
    version: process.env.NUXT_PUBLIC_APP_VERSION ?? 'dev',
    // Git-sha for den byggede revision (beslutning AJ). Kontrakten er en fuld
    // 40-tegns sha.
    //
    // 🔴 Hvad der beskytter i DAG, og hvad der ikke gør: runtime-assertion #8
    // ([infra], PLANLAGT — ikke bygget) SKAL holde denne værdi op mod imagets
    // OCI-label og git-ref'en bag tagget og afvise 'dev'/'unknown'/tom.
    // Indtil den findes, RAPPORTERER healthz kun — et prod-image der
    // regredierer til revision:"unknown" ville i dag blive meldt stille,
    // ikke fanget. Feltet er det ene ben; dommeren mangler.
    revision: process.env.NUXT_PUBLIC_APP_REVISION ?? 'unknown',
    uptime: Math.round(process.uptime()),
  }
})
