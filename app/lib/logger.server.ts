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

export const logger = {
  info(message: string, details?: Record<string, unknown>) {
    const ctx = getJobContext()
    const meta = ctx ? { job_id: ctx.jobId, job_type: ctx.jobType, app_id: ctx.appId } : {}
    winstonLogger.info(message, { trace_id: getTraceId(), ...details, ...meta })
    logToDb('info', message, details)
  },
  warn(message: string, details?: Record<string, unknown>) {
    const ctx = getJobContext()
    const meta = ctx ? { job_id: ctx.jobId, job_type: ctx.jobType, app_id: ctx.appId } : {}
    winstonLogger.warn(message, { trace_id: getTraceId(), ...details, ...meta })
    logToDb('warn', message, details)
  },
  error(message: string, errorOrDetails?: unknown) {
    const traceId = getTraceId()
    const ctx = getJobContext()
    const meta = ctx ? { job_id: ctx.jobId, job_type: ctx.jobType, app_id: ctx.appId } : {}
    if (errorOrDetails instanceof Error) {
      winstonLogger.error(message, {
        trace_id: traceId,
        error: errorOrDetails.message,
        stack_trace: errorOrDetails.stack,
        ...meta,
      })
      logToDb('error', message, {
        error: errorOrDetails.message,
        stack_trace: errorOrDetails.stack,
      })
    } else if (errorOrDetails && typeof errorOrDetails === 'object') {
      winstonLogger.error(message, { trace_id: traceId, ...(errorOrDetails as Record<string, unknown>), ...meta })
      logToDb('error', message, errorOrDetails as Record<string, unknown>)
    } else {
      winstonLogger.error(message, { trace_id: traceId, ...meta })
      logToDb('error', message)
    }
  },
  debug(message: string, details?: Record<string, unknown>) {
    const ctx = getJobContext()
    const meta = ctx ? { job_id: ctx.jobId, job_type: ctx.jobType, app_id: ctx.appId } : {}
    winstonLogger.debug(message, { trace_id: getTraceId(), ...details, ...meta })
    logToDb('debug', message, details)
  },
}
