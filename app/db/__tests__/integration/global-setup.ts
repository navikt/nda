import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { truncateAllTables } from './helpers'

export const TEMPLATE_DATABASE_ENV_VAR = 'NDA_TEMPLATE_DATABASE'
const DEFAULT_TEMPLATE_DATABASE = 'migrated_template'

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

  console.log('🧹 Clearing seed data before snapshotting...')
  const pool = new Pool({ connectionString: connectionUri })
  try {
    await truncateAllTables(pool)
  } finally {
    await pool.end()
  }

  console.log('📸 Snapshotting migrated schema as template...')
  container.withSnapshotName(DEFAULT_TEMPLATE_DATABASE)
  await container.snapshot()
  process.env[TEMPLATE_DATABASE_ENV_VAR] = DEFAULT_TEMPLATE_DATABASE

  console.log('✅ Test database ready')
}

export async function teardown() {
  if (container) {
    console.log('🧹 Stopping PostgreSQL test container...')
    await container.stop()
  }
}
