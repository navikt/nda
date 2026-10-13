import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { metrics } from '@opentelemetry/api'
import { logger, logOutgoingHttp } from '~/lib/logger.server'
import { withGitHubSpan } from '~/lib/tracing.server'

type GitHubRateLimitStatus = {
  remaining: number
  limit: number | null
  resetAt: Date | null
}

let octokit: Octokit | null = null
let requestCount = 0
let lastKnownRateLimitRemaining: number | null = null
let lastKnownRateLimitStatus: GitHubRateLimitStatus | null = null

export const GITHUB_RATE_LIMIT_SAFETY_BUFFER = 200

function updateGitHubRateLimitStatus(headers: Record<string, unknown>): void {
  const remainingHeader = headers['x-ratelimit-remaining']
  const limitHeader = headers['x-ratelimit-limit']
  const resetHeader = headers['x-ratelimit-reset']

  const remaining = remainingHeader !== undefined ? Number.parseInt(String(remainingHeader), 10) : NaN
  if (!Number.isFinite(remaining)) return

  const limit = limitHeader !== undefined ? Number.parseInt(String(limitHeader), 10) : NaN
  const resetEpochSeconds = resetHeader !== undefined ? Number.parseInt(String(resetHeader), 10) : NaN

  lastKnownRateLimitRemaining = remaining
  lastKnownRateLimitStatus = {
    remaining,
    limit: Number.isFinite(limit) ? limit : null,
    resetAt: Number.isFinite(resetEpochSeconds) ? new Date(resetEpochSeconds * 1000) : null,
  }

  if (remaining < 100) {
    logger.warn('GitHub rate limit low', {
      rate_limit_remaining: remaining,
      rate_limit_total: Number.parseInt(String(limitHeader ?? '0'), 10),
    })
  }
}

export function getGitHubRateLimitError(error: unknown): { remaining: number } | null {
  if (!error || typeof error !== 'object') return null
  const errorRecord = error as Record<string, unknown>
  const response =
    errorRecord.response && typeof errorRecord.response === 'object'
      ? (errorRecord.response as Record<string, unknown>)
      : null
  const headers =
    response?.headers && typeof response.headers === 'object' ? (response.headers as Record<string, unknown>) : null
  if (headers) updateGitHubRateLimitStatus(headers)

  const status = typeof response?.status === 'number' ? response.status : errorRecord.status
  if (typeof status !== 'number' || (status !== 403 && status !== 429)) return null

  const remainingHeader = headers?.['x-ratelimit-remaining']
  const remaining = remainingHeader === undefined ? NaN : Number.parseInt(String(remainingHeader), 10)
  const retryAfter = headers?.['retry-after']
  const responseData =
    response?.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>) : null
  const message = [errorRecord.message, responseData?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  const rateLimited =
    status === 429 ||
    remaining === 0 ||
    retryAfter !== undefined ||
    /api rate limit exceeded|secondary rate limit/i.test(message)

  if (!rateLimited) return null
  return { remaining: Number.isFinite(remaining) ? remaining : 0 }
}

export function getGitHubRateLimitRemaining(): number | null {
  if (lastKnownRateLimitStatus?.resetAt && lastKnownRateLimitStatus.resetAt.getTime() <= Date.now()) {
    return null
  }
  return lastKnownRateLimitRemaining
}

const meter = metrics.getMeter('deployment-audit')

meter
  .createObservableGauge('github.rate_limit.remaining', { description: 'GitHub API rate limit remaining' })
  .addCallback((result) => {
    if (lastKnownRateLimitStatus) {
      result.observe(lastKnownRateLimitStatus.remaining)
    }
  })

meter
  .createObservableGauge('github.rate_limit.limit', { description: 'GitHub API rate limit ceiling' })
  .addCallback((result) => {
    if (lastKnownRateLimitStatus?.limit !== null && lastKnownRateLimitStatus?.limit !== undefined) {
      result.observe(lastKnownRateLimitStatus.limit)
    }
  })

meter
  .createObservableGauge('github.rate_limit.reset_seconds', {
    description: 'Seconds until the GitHub API rate limit resets',
  })
  .addCallback((result) => {
    if (lastKnownRateLimitStatus?.resetAt) {
      const secondsUntilReset = Math.max(
        0,
        Math.round((lastKnownRateLimitStatus.resetAt.getTime() - Date.now()) / 1000),
      )
      result.observe(secondsUntilReset)
    }
  })

export function getGitHubClient(): Octokit {
  if (!octokit) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID
    const pat = process.env.GITHUB_TOKEN

    if (appId && privateKey && installationId) {
      logger.info('🔐 Using GitHub App authentication')

      let decodedPrivateKey = privateKey
      if (!privateKey.includes('-----BEGIN')) {
        decodedPrivateKey = Buffer.from(privateKey, 'base64').toString('utf-8')
      }

      octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: parseInt(appId, 10),
          privateKey: decodedPrivateKey,
          installationId: parseInt(installationId, 10),
        },
        log: {
          debug: () => {},
          info: () => {},
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
        },
      })
    } else if (pat) {
      logger.info('🔑 Using Personal Access Token authentication')

      octokit = new Octokit({
        auth: pat,
        log: {
          debug: () => {},
          info: () => {},
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
        },
      })
    } else {
      throw new Error(
        'GitHub authentication not configured. Set either GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID, or GITHUB_TOKEN',
      )
    }

    octokit.hook.before('request', (_options) => {
      requestCount++
    })

    octokit.hook.after('request', (response, _options) => {
      updateGitHubRateLimitStatus(response.headers)
    })

    octokit.hook.wrap('request', async (request, options) => {
      const thisRequestNumber = requestCount
      const method = options.method || 'GET'
      let path = options.url?.replace('https://api.github.com', '') || ''
      if (options.owner) path = path.replace('{owner}', options.owner as string)
      if (options.repo) path = path.replace('{repo}', options.repo as string)
      if (options.pull_number) path = path.replace('{pull_number}', String(options.pull_number))
      if (options.commit_sha) path = path.replace('{commit_sha}', (options.commit_sha as string).substring(0, 7))
      if (options.ref) path = path.replace('{ref}', (options.ref as string).substring(0, 7))
      if (options.issue_number) path = path.replace('{issue_number}', String(options.issue_number))
      if (options.run_id) path = path.replace('{run_id}', String(options.run_id))
      if (options.base && options.head) {
        path = path.replace('{base}', (options.base as string).substring(0, 7))
        path = path.replace('{head}', (options.head as string).substring(0, 7))
      }
      path = path.split('?')[0]

      const start = Date.now()
      try {
        const response = await withGitHubSpan(`${method} ${path}`, async () => request(options))
        logOutgoingHttp({
          area: 'github',
          method,
          host: 'api.github.com',
          path,
          status_code: response.status,
          duration_ms: Date.now() - start,
          request_number: thisRequestNumber,
          ...(options.page !== undefined && { page: options.page }),
        })
        return response
      } catch (error) {
        const response = error && typeof error === 'object' && 'response' in error ? error.response : undefined
        if (response && typeof response === 'object' && 'headers' in response && response.headers) {
          updateGitHubRateLimitStatus(response.headers as Record<string, unknown>)
        }
        logOutgoingHttp({
          area: 'github',
          method,
          host: 'api.github.com',
          path,
          duration_ms: Date.now() - start,
          ...(typeof (error as { status?: number }).status === 'number' && {
            status_code: (error as { status: number }).status,
          }),
          error: error instanceof Error ? error.message : 'Request failed',
          request_number: thisRequestNumber,
        })
        throw error
      }
    })
  }

  return octokit
}
