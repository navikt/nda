import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getPreviousDeploymentForDiff: vi.fn().mockResolvedValue(null),
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

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(function MockApp() {
    return {
      client: { chat: { postMessage: postMessageMock } },
      start: vi.fn(),
      stop: vi.fn(),
      action: vi.fn(),
      event: vi.fn(),
    }
  }),
  LogLevel: { DEBUG: 'debug', INFO: 'info' },
}))

function buildReminderNotification() {
  return {
    appName: 'pensjon-pen',
    environmentName: 'prod-fss',
    teamSlug: 'pensjondeployer',
    deployments: [
      {
        id: 1,
        commitSha: 'abc1234def5678901234567890abcdef1234567',
        deployerName: 'Glad Fjord',
        status: 'not_approved',
        createdAt: '10.02.2026, 09:15',
        detailsUrl: 'https://nda.ansatt.nav.no/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments/1',
      },
    ],
    deploymentsListUrl:
      'https://nda.ansatt.nav.no/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments?status=not_approved&period=all',
  }
}

describe('sendReminder — records reminder Slack notification history', () => {
  beforeEach(() => {
    vi.resetModules()
    postMessageMock.mockReset()
    createSlackNotificationMock.mockReset()
    loggerErrorMock.mockReset()
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    process.env.SLACK_APP_TOKEN = 'xapp-test'
  })

  async function getClientModule() {
    return import('../client.server')
  }

  it('records the reminder in Slack notification history with the monitored app id', async () => {
    postMessageMock.mockResolvedValue({ ts: '1234.5678' })
    const { sendReminder } = await getClientModule()

    const messageTs = await sendReminder(buildReminderNotification(), 'C0REMIND1', 42)

    expect(messageTs).toBe('1234.5678')
    expect(createSlackNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoredAppId: 42,
        channelId: 'C0REMIND1',
        messageTs: '1234.5678',
        notificationType: 'reminder',
      }),
    )
  })

  it('does not record history when monitoredAppId is not provided', async () => {
    postMessageMock.mockResolvedValue({ ts: '1234.5678' })
    const { sendReminder } = await getClientModule()

    const messageTs = await sendReminder(buildReminderNotification(), 'C0REMIND1')

    expect(messageTs).toBe('1234.5678')
    expect(createSlackNotificationMock).not.toHaveBeenCalled()
  })

  it('does not fail sending the reminder when recording history throws', async () => {
    postMessageMock.mockResolvedValue({ ts: '1234.5678' })
    createSlackNotificationMock.mockRejectedValue(new Error('db unavailable'))
    const { sendReminder } = await getClientModule()

    const messageTs = await sendReminder(buildReminderNotification(), 'C0REMIND1', 42)

    expect(messageTs).toBe('1234.5678')
    expect(loggerErrorMock).toHaveBeenCalled()
  })
})
