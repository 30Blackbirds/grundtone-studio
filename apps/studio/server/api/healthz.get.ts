// Liveness probe — fast, no auth, no DB. Deploy workflows poll this after
// `docker compose up -d` to confirm the new image is serving requests.
//
// Don't extend this with DB/storage checks; those belong on /readyz so a slow
// dependency doesn't take the container out of rotation while it self-heals.

export default defineEventHandler(() => {
  return {
    status: 'ok',
    version: process.env.NUXT_PUBLIC_APP_VERSION ?? 'dev',
    uptime: Math.round(process.uptime()),
  }
})
