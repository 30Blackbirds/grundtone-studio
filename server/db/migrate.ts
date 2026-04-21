import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

const client = postgres(url, { max: 1, prepare: false })
const db = drizzle(client)

await migrate(db, { migrationsFolder: './server/db/migrations' })
console.log('Migrations applied')
await client.end()
