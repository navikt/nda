import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

let container: StartedPostgreSqlContainer | undefined

export async function setup() {
  console.log('🐘 Starting PostgreSQL test container...')

  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const connectionUri = container.getConnectionUri()

  process.env.DATABASE_URL = connectionUri

  console.log('🔄 Running migrations...')
  const { runner } = await import('node-pg-migrate')
  await runner({
    databaseUrl: connectionUri,
    dir: join(process.cwd(), 'app/db/migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    schema: 'public',
    log: () => {}, // suppress migration output
  })

  console.log('📸 Snapshotting migrated schema as template...')
  await container.snapshot()

  console.log('✅ Test database ready')
}

export async function teardown() {
  if (container) {
    console.log('🧹 Stopping PostgreSQL test container...')
    await container.stop()
  }
}
