import { Client } from 'pg'

const TEMPLATE_DATABASE = 'migrated_template'

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri)
  url.pathname = `/${database}`
  return url.toString()
}

const baseUrl = process.env.DATABASE_URL
if (!baseUrl) {
  throw new Error('DATABASE_URL is not set — global-setup must run before worker-db-setup')
}

const workerId = process.env.VITEST_POOL_ID ?? '0'
const workerDatabase = `test_worker_${workerId}`

if (!process.env.NDA_WORKER_DB_READY) {
  const adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') })
  await adminClient.connect()
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS "${workerDatabase}" WITH (FORCE)`)
    await adminClient.query(`CREATE DATABASE "${workerDatabase}" TEMPLATE "${TEMPLATE_DATABASE}"`)
  } finally {
    await adminClient.end()
  }
  process.env.NDA_WORKER_DB_READY = '1'
}

process.env.DATABASE_URL = withDatabase(baseUrl, workerDatabase)
