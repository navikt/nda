import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Storage } from '@google-cloud/storage'
import { logger } from './logger.server'

const BUCKET_ENV_VAR = 'BUCKET_NAME_PENSJON_DEPLOYMENT_AUDIT_LOGS'
const LOG_PREFIX = 'build-logs'

let storage: Storage | null = null

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage()
  }
  return storage
}

function getBucketName(): string {
  const name = process.env[BUCKET_ENV_VAR]
  if (!name) {
    throw new Error(`Environment variable ${BUCKET_ENV_VAR} is not set. Is the GCS bucket configured in nais.yaml?`)
  }
  return name
}

function logPath(owner: string, repo: string, checkRunId: number): string {
  return `${LOG_PREFIX}/${owner}/${repo}/${checkRunId}.log`
}

export async function logExists(owner: string, repo: string, checkRunId: number): Promise<boolean> {
  try {
    const bucket = getStorage().bucket(getBucketName())
    const [exists] = await bucket.file(logPath(owner, repo, checkRunId)).exists()
    return exists
  } catch (error) {
    logger.warn(`GCS logExists check failed: ${error}`)
    return false
  }
}

export async function uploadLog(
  owner: string,
  repo: string,
  checkRunId: number,
  content: string | Buffer,
): Promise<void> {
  const bucket = getStorage().bucket(getBucketName())
  const file = bucket.file(logPath(owner, repo, checkRunId))

  const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  const readable = Readable.from(data)
  const writable = file.createWriteStream({
    contentType: 'text/plain; charset=utf-8',
    resumable: false,
    metadata: {
      cacheControl: 'private, max-age=0',
    },
  })

  await pipeline(readable, writable)
  logger.info(`Uploaded log to GCS: ${logPath(owner, repo, checkRunId)} (${data.length} bytes)`)
}

export async function downloadLog(owner: string, repo: string, checkRunId: number): Promise<string | null> {
  try {
    const bucket = getStorage().bucket(getBucketName())
    const file = bucket.file(logPath(owner, repo, checkRunId))
    const [content] = await file.download()
    return content.toString('utf-8')
  } catch (error) {
    logger.warn(`GCS download failed for ${logPath(owner, repo, checkRunId)}: ${error}`)
    return null
  }
}

export function isGcsConfigured(): boolean {
  return !!process.env[BUCKET_ENV_VAR]
}

const bucketEnvVars = Object.keys(process.env).filter((k) => k.includes('BUCKET') || k.includes('STORAGE'))
if (process.env[BUCKET_ENV_VAR]) {
  logger.info(`GCS bucket configured: ${process.env[BUCKET_ENV_VAR]}`)
} else {
  logger.warn(
    `GCS bucket NOT configured. Expected env var: ${BUCKET_ENV_VAR}. ` +
      `Tilgjengelige bucket/storage-variabler: ${bucketEnvVars.length > 0 ? bucketEnvVars.join(', ') : '(ingen)'}`,
  )
}
