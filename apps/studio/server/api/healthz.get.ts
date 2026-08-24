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
    // 🔴 Hvad der beskytter i dag: deploy-smoken LÆSER dette felt på den
    // offentlige vhost og afviser 'dev'/'unknown'/tom samt enhver værdi, der
    // ikke er dette runs build
    // (.github/scripts/assert-served-revision.sh, begge miljøer).
    //
    // Hvad der stadig IKKE er dækket: build-arg'en, OCI-labelen og
    // sammenligningsgrundlaget stammer alle fra `github.sha`. Stemples den
    // forkert ved build, er alle tre enige om samme løgn. Det ben kræver en
    // uafhængig kilde — tag → commit via GitHub-API'et — og er ikke bygget.
    // Feltet har fået sin dommer; dommeren har endnu kun ét vidne.
    revision: process.env.NUXT_PUBLIC_APP_REVISION ?? 'unknown',
    uptime: Math.round(process.uptime()),
  }
})
