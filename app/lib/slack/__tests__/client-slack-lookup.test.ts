import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/db/boards.server', () => ({ getActiveBoardsWithKeywordsForDevTeam: vi.fn() }))
vi.mock('~/db/deployments/home.server', () => ({
  getDevTeamAppsWithIssues: vi.fn(),
  getUnmappedContributors: vi.fn(),
  resolveDevTeamScope: vi.fn(),
}))
vi.mock('~/db/deployments.server', () => ({
  claimDeploymentForDeployNotify: vi.fn(),
  claimDeploymentForSlackNotification: vi.fn(),
  getDeploymentsNeedingDeployNotify: vi.fn(),
  getPersonalDeploymentsMissingGoalLinks: vi.fn(),
}))
vi.mock('~/db/role-assignments.server', () => ({ getUserDevTeamsByRole: vi.fn() }))
vi.mock('~/db/slack-notifications.server', () => ({
  createSlackNotification: vi.fn(),
  getSlackNotificationByMessage: vi.fn(),
  logSlackInteraction: vi.fn(),
  updateSlackNotification: vi.fn(),
}))
vi.mock('~/db/user-github-lookups.server', () => ({ getUserBySlackMemberId: vi.fn() }))
vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logOutgoingHttp: vi.fn(),
}))

const lookupByEmailMock = vi.fn()

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(function MockApp() {
    return {
      client: { users: { lookupByEmail: lookupByEmailMock } },
      start: vi.fn(),
      stop: vi.fn(),
      action: vi.fn(),
      event: vi.fn(),
    }
  }),
  LogLevel: { DEBUG: 'debug', INFO: 'info' },
}))

describe('slack client.server - Slack member ID lookup', () => {
  const originalBotToken = process.env.SLACK_BOT_TOKEN
  const originalAppToken = process.env.SLACK_APP_TOKEN

  beforeEach(() => {
    vi.resetModules()
    lookupByEmailMock.mockReset()
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    process.env.SLACK_APP_TOKEN = 'xapp-test'
  })

  afterEach(() => {
    process.env.SLACK_BOT_TOKEN = originalBotToken
    process.env.SLACK_APP_TOKEN = originalAppToken
  })

  async function getClientModule() {
    return import('../client.server')
  }

  it('returns null without calling Slack when Slack is not configured', async () => {
    delete process.env.SLACK_BOT_TOKEN
    const { lookupSlackUserIdByEmail } = await getClientModule()

    const result = await lookupSlackUserIdByEmail('user@nav.no')

    expect(result).toBeNull()
    expect(lookupByEmailMock).not.toHaveBeenCalled()
  })

  it('returns the Slack member ID when found by email', async () => {
    lookupByEmailMock.mockResolvedValue({ user: { id: 'U123456' } })
    const { lookupSlackUserIdByEmail } = await getClientModule()

    const result = await lookupSlackUserIdByEmail('user@nav.no')

    expect(result).toBe('U123456')
    expect(lookupByEmailMock).toHaveBeenCalledWith({ email: 'user@nav.no' })
  })

  it('returns null when Slack reports users_not_found', async () => {
    lookupByEmailMock.mockRejectedValue({ data: { error: 'users_not_found' } })
    const { lookupSlackUserIdByEmail } = await getClientModule()

    const result = await lookupSlackUserIdByEmail('unknown@nav.no')

    expect(result).toBeNull()
  })

  it('resolveSlackMemberId prefers the automatically found Slack ID over the submitted value', async () => {
    lookupByEmailMock.mockResolvedValue({ user: { id: 'U999999' } })
    const { resolveSlackMemberId } = await getClientModule()

    const result = await resolveSlackMemberId('user@nav.no', 'U000000')

    expect(result).toBe('U999999')
  })

  it('resolveSlackMemberId falls back to the submitted value when no email is available', async () => {
    const { resolveSlackMemberId } = await getClientModule()

    const result = await resolveSlackMemberId(null, 'U000000')

    expect(result).toBe('U000000')
    expect(lookupByEmailMock).not.toHaveBeenCalled()
  })

  it('resolveSlackMemberId falls back to the submitted value when Slack lookup finds nothing', async () => {
    lookupByEmailMock.mockRejectedValue({ data: { error: 'users_not_found' } })
    const { resolveSlackMemberId } = await getClientModule()

    const result = await resolveSlackMemberId('user@nav.no', 'U000000')

    expect(result).toBe('U000000')
  })
})
