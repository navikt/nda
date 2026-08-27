import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/db/boards.server', () => ({ getActiveBoardsWithKeywordsForDevTeam: vi.fn() }))
vi.mock('~/db/deployments/home.server', () => ({
  getDevTeamAppsWithIssues: vi.fn(),
  getUnmappedContributors: vi.fn(),
  resolveDevTeamScope: vi.fn(),
}))

const claimDeploymentForDeployNotifyMock = vi.fn()
const getDeploymentsNeedingDeployNotifyMock = vi.fn()

vi.mock('~/db/deployments.server', () => ({
  claimDeploymentForDeployNotify: claimDeploymentForDeployNotifyMock,
  claimDeploymentForSlackNotification: vi.fn(),
  getDeploymentsNeedingDeployNotify: getDeploymentsNeedingDeployNotifyMock,
  getPersonalDeploymentsMissingGoalLinks: vi.fn(),
}))

vi.mock('~/db/role-assignments.server', () => ({ getUserDevTeamsByRole: vi.fn() }))

const createSlackNotificationMock = vi.fn()

vi.mock('~/db/slack-notifications.server', () => ({
  createSlackNotification: createSlackNotificationMock,
  getSlackNotificationByMessage: vi.fn(),
  logSlackInteraction: vi.fn(),
  updateSlackNotification: vi.fn(),
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getUserBySlackMemberId: vi.fn(),
  getGithubUserLookups: vi.fn().mockResolvedValue(new Map()),
}))

const loggerErrorMock = vi.fn()

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), error: loggerErrorMock, warn: vi.fn() },
  logOutgoingHttp: vi.fn(),
}))

const postMessageMock = vi.fn()
const chatDeleteMock = vi.fn()

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(function MockApp() {
    return {
      client: { chat: { postMessage: postMessageMock, delete: chatDeleteMock } },
      start: vi.fn(),
      stop: vi.fn(),
      action: vi.fn(),
      event: vi.fn(),
    }
  }),
  LogLevel: { DEBUG: 'debug', INFO: 'info' },
}))

function buildDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    monitored_app_id: 10,
    commit_sha: 'abc1234def5678901234567890abcdef1234567',
    deployer_username: 'glad-fjord',
    github_pr_number: null,
    github_pr_url: null,
    github_pr_data: null,
    four_eyes_status: 'implicitly_approved',
    title: 'Deploy pensjon-pen',
    branch_name: 'main',
    slack_deploy_message_ts: null,
    team_slug: 'pensjondeployer',
    environment_name: 'prod-fss',
    app_name: 'pensjon-pen',
    slack_deploy_channel_id: 'C0DEPLOY123',
    slack_deploy_notify_enabled: true,
    ...overrides,
  }
}

describe('sendPendingDeployNotifications', () => {
  beforeEach(() => {
    vi.resetModules()
    postMessageMock.mockReset()
    chatDeleteMock.mockReset()
    claimDeploymentForDeployNotifyMock.mockReset()
    getDeploymentsNeedingDeployNotifyMock.mockReset()
    createSlackNotificationMock.mockReset()
    loggerErrorMock.mockReset()
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    process.env.SLACK_APP_TOKEN = 'xapp-test'
  })

  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN
    delete process.env.SLACK_APP_TOKEN
  })

  async function getClientModule() {
    return import('../client.server')
  }

  it('records a deploy notification in Slack notification history so it appears in the message log', async () => {
    const deployment = buildDeployment()
    getDeploymentsNeedingDeployNotifyMock.mockResolvedValue([deployment])
    postMessageMock.mockResolvedValue({ ts: '1234.5678' })
    claimDeploymentForDeployNotifyMock.mockResolvedValue(deployment)

    const { sendPendingDeployNotifications } = await getClientModule()

    const sentCount = await sendPendingDeployNotifications('https://nda.ansatt.nav.no')

    expect(sentCount).toBe(1)
    expect(createSlackNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: deployment.id,
        channelId: 'C0DEPLOY123',
        messageTs: '1234.5678',
        notificationType: 'deploy',
      }),
    )
  })

  it('does not fail the notification when recording history throws', async () => {
    const deployment = buildDeployment()
    getDeploymentsNeedingDeployNotifyMock.mockResolvedValue([deployment])
    postMessageMock.mockResolvedValue({ ts: '1234.5678' })
    claimDeploymentForDeployNotifyMock.mockResolvedValue(deployment)
    createSlackNotificationMock.mockRejectedValue(new Error('db unavailable'))

    const { sendPendingDeployNotifications } = await getClientModule()

    const sentCount = await sendPendingDeployNotifications('https://nda.ansatt.nav.no')

    expect(sentCount).toBe(1)
    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('does not record history when another process already claimed the deployment', async () => {
    const deployment = buildDeployment()
    getDeploymentsNeedingDeployNotifyMock.mockResolvedValue([deployment])
    postMessageMock.mockResolvedValue({ ts: '1234.5678' })
    claimDeploymentForDeployNotifyMock.mockResolvedValue(null)

    const { sendPendingDeployNotifications } = await getClientModule()

    const sentCount = await sendPendingDeployNotifications('https://nda.ansatt.nav.no')

    expect(sentCount).toBe(0)
    expect(createSlackNotificationMock).not.toHaveBeenCalled()
    expect(chatDeleteMock).toHaveBeenCalled()
  })
})
