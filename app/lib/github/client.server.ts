import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { logger, logOutgoingHttp } from '~/lib/logger.server'
import { withGitHubSpan } from '~/lib/tracing.server'

let octokit: Octokit | null = null
let requestCount = 0

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
      const remaining = response.headers['x-ratelimit-remaining']
      const limit = response.headers['x-ratelimit-limit']
      if (remaining && parseInt(remaining, 10) < 100) {
        logger.warn('GitHub rate limit low', {
          rate_limit_remaining: parseInt(remaining, 10),
          rate_limit_total: parseInt(limit ?? '0', 10),
        })
      }
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
