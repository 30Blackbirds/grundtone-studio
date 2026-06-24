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
    version: process.env.NUXT_PUBLIC_APP_VERSION ?? 'dev',
    uptime: Math.round(process.uptime()),
  }
})
