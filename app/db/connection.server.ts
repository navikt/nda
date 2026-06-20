import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import { logger } from '~/lib/logger.server'
import { withDbSpan } from '~/lib/tracing.server'

let poolInstance: Pool | null = null

const MAX_RETRIES = 3
const BASE_DELAY_MS = 200

function isConnectionExhausted(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === '53300'
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      if (!isConnectionExhausted(err) || attempt === MAX_RETRIES) throw err
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, 2000)
      logger.warn(`DB connection exhausted (53300), retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}

function buildConnectionConfig() {
  const dbHost = process.env.DB_HOST
  const dbPort = process.env.DB_PORT
  const dbDatabase = process.env.DB_DATABASE
  const dbUsername = process.env.DB_USERNAME
  const dbPassword = process.env.DB_PASSWORD
  const dbSslCert = process.env.DB_SSLCERT
  const dbSslKey = process.env.DB_SSLKEY
  const dbSslRootCert = process.env.DB_SSLROOTCERT

  if (dbHost && dbDatabase && dbUsername && dbPassword) {
    const sslConfig: { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } = {
      rejectUnauthorized: false,
    }

    if (dbSslRootCert) {
      sslConfig.ca = readFileSync(dbSslRootCert, 'utf-8')
    }
    if (dbSslCert) {
      sslConfig.cert = readFileSync(dbSslCert, 'utf-8')
    }
    if (dbSslKey) {
      sslConfig.key = readFileSync(dbSslKey, 'utf-8')
    }

    return {
      host: dbHost,
      port: dbPort ? parseInt(dbPort, 10) : 5432,
      database: dbDatabase,
      user: dbUsername,
      password: dbPassword,
      ssl: sslConfig,
    }
  }

  const connectionString = process.env.DATABASE_URL
  if (connectionString) {
    return { connectionString }
  }

  throw new Error('Database configuration missing. Set DB_* variables (Nais) or DATABASE_URL (local)')
}

export function getPool(): Pool {
  if (!poolInstance) {
    const config = buildConnectionConfig()

    poolInstance = new Pool({
      ...config,
      max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })

    poolInstance.on('error', (err) => {
      logger.error('Unexpected error on idle client', err)
    })
  }

  return poolInstance
}

const syncClientStore = new AsyncLocalStorage<PoolClient>()

export const SYNC_ADVISORY_LOCK_KEY = 839_201_471

export function getSyncClient(): PoolClient | undefined {
  return syncClientStore.getStore()
}

export async function withSyncClient<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await getPool().connect()
  let destroyed = false
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(${SYNC_ADVISORY_LOCK_KEY}) AS locked`,
    )
    if (!rows[0].locked) {
      return null
    }

    try {
      return await syncClientStore.run(client, fn)
    } finally {
      try {
        await client.query(`SELECT pg_advisory_unlock(${SYNC_ADVISORY_LOCK_KEY})`)
      } catch (unlockError) {
        logger.error('Failed to release advisory lock, destroying connection', unlockError)
        destroyed = true
        client.release(true)
      }
    }
  } finally {
    if (!destroyed) {
      client.release()
    }
  }
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const instance = getPool()
    const value = (instance as any)[prop]
    if (typeof value !== 'function') return value

    if (prop === 'query') {
      return (...args: any[]) => {
        const syncClient = getSyncClient()
        const target = syncClient ?? instance
        const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || 'unknown'
        const operation = extractOperation(sql)
        return withDbSpan(operation, sql, () => withRetry(() => (target as any).query(...args)))
      }
    }

    if (prop === 'connect') {
      return (...args: any[]) => {
        const syncClient = getSyncClient()
        if (syncClient) {
          const client = new Proxy(syncClient, {
            get(target, clientProp) {
              if (clientProp === 'release') return () => {}
              const val = (target as any)[clientProp]
              return typeof val === 'function' ? val.bind(target) : val
            },
          }) as PoolClient

          const callback = typeof args[0] === 'function' ? args[0] : undefined
          if (callback) {
            callback(null, client, client.release.bind(client))
            return
          }

          return Promise.resolve(client)
        }
        return withRetry(() => value.call(instance, ...args))
      }
    }

    return value.bind(instance)
  },
})

function extractOperation(sql: string): string {
  const trimmed = sql.trimStart().toUpperCase()
  if (trimmed.startsWith('SELECT')) return 'SELECT'
  if (trimmed.startsWith('INSERT')) return 'INSERT'
  if (trimmed.startsWith('UPDATE')) return 'UPDATE'
  if (trimmed.startsWith('DELETE')) return 'DELETE'
  if (trimmed.startsWith('WITH')) return 'WITH'
  return 'QUERY'
}

export async function query<T extends Record<string, any> = any>(
  text: string,
  params?: any[],
): Promise<QueryResult<T>> {
  const operation = extractOperation(text)
  return withDbSpan(operation, text, () =>
    withRetry(() => {
      const syncClient = getSyncClient()
      const target = syncClient ?? getPool()
      return target.query<T>(text, params)
    }),
  )
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
  }
}
