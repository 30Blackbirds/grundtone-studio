import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://grundtone:grundtone_dev@127.0.0.1:54320/grundtone_studio',
  },
  casing: 'snake_case',
})
