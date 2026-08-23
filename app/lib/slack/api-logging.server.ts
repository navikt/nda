import { logOutgoingHttp } from '~/lib/logger.server'

export async function callSlackApi<T>(slackMethod: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    logOutgoingHttp({
      area: 'slack',
      method: 'POST',
      host: 'slack.com',
      path: `/api/${slackMethod}`,
      status_code: 200,
      duration_ms: Date.now() - start,
    })
    return result
  } catch (error) {
    logOutgoingHttp({
      area: 'slack',
      method: 'POST',
      host: 'slack.com',
      path: `/api/${slackMethod}`,
      duration_ms: Date.now() - start,
      error: error instanceof Error ? error.message : 'Slack API error',
    })
    throw error
  }
}
