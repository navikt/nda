import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const TEMPLATE_DATABASE = 'migrated_template'

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri)
  url.pathname = `/${database}`
  return url.toString()
}

const baseUrl = process.env.DATABASE_URL
if (!baseUrl) {
  throw new Error('DATABASE_URL is not set — global-setup must run before test-database-setup')
}

const testDatabase = `test_${randomUUID().replaceAll('-', '')}`

const adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') })
await adminClient.connect()
try {
  await adminClient.query(`CREATE DATABASE "${testDatabase}" TEMPLATE "${TEMPLATE_DATABASE}"`)
} finally {
  await adminClient.end()
}

process.env.DATABASE_URL = withDatabase(baseUrl, testDatabase)
