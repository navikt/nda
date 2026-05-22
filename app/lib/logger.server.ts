import { AsyncLocalStorage } from 'node:async_hooks'
import winston from 'winston'
import type { SyncJobType } from '~/db/sync-job-types'
import { logSyncJobMessage } from '~/db/sync-jobs.server'
import { getTraceId } from '~/lib/tracing.server'

// =============================================================================
// Job Context via AsyncLocalStorage
// =============================================================================

interface JobContext {
  jobId: number
  jobType: SyncJobType
  appId: number
  debug: boolean
}

const jobContextStorage = new AsyncLocalStorage<JobContext>()

/**
 * Run a function within a sync job context.
 * All logger calls within this context will also write to the job's DB log,
 * and will include job_id, job_type and app_id as structured fields in Winston.
 */
export function runWithJobContext<T>(
  jobId: number,
  jobType: SyncJobType,
  appId: number,
  debug: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  return jobContextStorage.run({ jobId, jobType, appId, debug }, fn)
}

function getJobContext(): JobContext | undefined {
  return jobContextStorage.getStore()
}

function getJobMeta(): Record<string, unknown> {
  const ctx = getJobContext()
  return ctx ? { job_id: ctx.jobId, job_type: ctx.jobType, app_id: ctx.appId } : {}
}

// =============================================================================
// Winston Configuration
// =============================================================================

const isProd = process.env.NODE_ENV === 'production'

const applicationVersion = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'unknown'

const winstonLogger = winston.createLogger({
  level: 'debug',
  defaultMeta: { applicationVersion },
  format: isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  transports: [new winston.transports.Console()],
})

// =============================================================================
// Dual Logger (console + DB when in job context)
// =============================================================================

function stripEmoji(message: string): string {
  return message.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim()
}

function logToDb(level: 'info' | 'warn' | 'error' | 'debug', message: string, details?: Record<string, unknown>) {
  const ctx = getJobContext()
  if (!ctx) return
  if (level === 'debug' && !ctx.debug) return

  // Fire-and-forget to avoid slowing down the sync loop
  logSyncJobMessage(ctx.jobId, level, stripEmoji(message), details).catch(() => {})
}

// =============================================================================
// Outgoing HTTP Logging
// =============================================================================

type OutgoingHttpArea = 'github' | 'slack' | 'microsoft_graph' | 'nais_auth' | 'nais_graphql'

/**
 * Log a structured entry for an outgoing HTTP request.
 * Always sets type: 'outgoing_http' — use this field in ELK to filter all outgoing calls.
 * Query strings are never included in `path` to avoid logging user data.
 */
export function logOutgoingHttp(details: {
  area: OutgoingHttpArea
  method: string
  host: string
  path: string
  status_code?: number
  duration_ms?: number
  error?: string
  [key: string]: unknown
}): void {
  // type is set last so callers cannot accidentally override it via the index signature
  logger.info('Outgoing HTTP request', { ...details, type: 'outgoing_http' })
}

/** Parse host and pathname from a URL that may be a string or URL object. */
function parseUrl(url: string | URL): { hostname: string; pathname: string } {
  try {
    const parsed = new URL(url)
    return { hostname: parsed.hostname, pathname: parsed.pathname }
  } catch {
    // Relative URL or unparseable — log what we can
    const str = url.toString()
    const pathOnly = str.split('?')[0]
    return { hostname: '(relative)', pathname: pathOnly }
  }
}

/**
 * Drop-in replacement for `fetch` that logs the request and response as a
 * structured outgoing HTTP entry. Query strings are stripped from the logged
 * path to avoid capturing user-supplied data (e.g. Graph $filter values).
 */
export async function fetchWithLogging(
  area: OutgoingHttpArea,
  url: string | URL,
  options?: RequestInit,
): Promise<Response> {
  const { hostname, pathname } = parseUrl(url)
  const method = (options?.method ?? 'GET').toUpperCase()
  const start = Date.now()
  try {
    const response = await fetch(url, options)
    logOutgoingHttp({
      area,
      method,
      host: hostname,
      path: pathname,
      status_code: response.status,
      duration_ms: Date.now() - start,
    })
    return response
  } catch (error) {
    logOutgoingHttp({
      area,
      method,
      host: hostname,
      path: pathname,
      duration_ms: Date.now() - start,
      error: error instanceof Error ? error.message : 'Network error',
    })
    throw error
  }
}

export const logger = {
  info(message: string, details?: Record<string, unknown>) {
    winstonLogger.info(message, { trace_id: getTraceId(), ...details, ...getJobMeta() })
    logToDb('info', message, details)
  },
  warn(message: string, details?: Record<string, unknown>) {
    winstonLogger.warn(message, { trace_id: getTraceId(), ...details, ...getJobMeta() })
    logToDb('warn', message, details)
  },
  error(message: string, errorOrDetails?: unknown) {
    const traceId = getTraceId()
    const jobMeta = getJobMeta()
    if (errorOrDetails instanceof Error) {
      winstonLogger.error(message, {
        trace_id: traceId,
        error: errorOrDetails.message,
        stack_trace: errorOrDetails.stack,
        ...jobMeta,
      })
      logToDb('error', message, {
        error: errorOrDetails.message,
        stack_trace: errorOrDetails.stack,
      })
    } else if (errorOrDetails && typeof errorOrDetails === 'object') {
      winstonLogger.error(message, { trace_id: traceId, ...(errorOrDetails as Record<string, unknown>), ...jobMeta })
      logToDb('error', message, errorOrDetails as Record<string, unknown>)
    } else {
      winstonLogger.error(message, { trace_id: traceId, ...jobMeta })
      logToDb('error', message)
    }
  },
  debug(message: string, details?: Record<string, unknown>) {
    winstonLogger.debug(message, { trace_id: getTraceId(), ...details, ...getJobMeta() })
    logToDb('debug', message, details)
  },
}
