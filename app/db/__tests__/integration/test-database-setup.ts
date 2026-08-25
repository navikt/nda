import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { TEMPLATE_DATABASE_ENV_VAR } from './global-setup'

const DEFAULT_TEMPLATE_DATABASE = 'migrated_template'

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri)
  url.pathname = `/${database}`
  return url.toString()
}

const baseUrl = process.env.DATABASE_URL
if (!baseUrl) {
  throw new Error('DATABASE_URL is not set — global-setup must run before test-database-setup')
}

const templateDatabase = process.env[TEMPLATE_DATABASE_ENV_VAR] ?? DEFAULT_TEMPLATE_DATABASE
const testDatabase = `test_${randomUUID().replaceAll('-', '')}`

const adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') })
await adminClient.connect()
try {
  await adminClient.query(`CREATE DATABASE "${testDatabase}" TEMPLATE "${templateDatabase}"`)
} finally {
  await adminClient.end()
}

process.env.DATABASE_URL = withDatabase(baseUrl, testDatabase)
