import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitoredApplication } from '~/db/monitored-applications.server'
import type { NaisApplicationUpdatedActivity } from '~/lib/nais.server'

const { getNaisApplyActivityEvents, getMonitoredApplicationById, upsertNaisApplyDeployment, fetchWorkflowRunHeadSha } =
  vi.hoisted(() => ({
    getNaisApplyActivityEvents: vi.fn(),
    getMonitoredApplicationById: vi.fn(),
    upsertNaisApplyDeployment: vi.fn(),
    fetchWorkflowRunHeadSha: vi.fn(),
  }))

vi.mock('~/db/nais-apply-activity.server', () => ({ getNaisApplyActivityEvents }))
vi.mock('~/db/deployments.server', () => ({ upsertNaisApplyDeployment }))
vi.mock('~/db/monitored-applications.server', () => ({ getMonitoredApplicationById }))
vi.mock('~/lib/github/git.server', () => ({ fetchWorkflowRunHeadSha }))
vi.mock('~/lib/logger.server', () => ({ logger: { warn: vi.fn() } }))

import { materializeNaisApplyDeployments } from '../nais-apply-materialize.server'

const monitoredApp: MonitoredApplication = {
  id: 7,
  team_slug: 'team-a',
  environment_name: 'prod-gcp',
  app_name: 'app-a',
  is_active: true,
  default_branch: null,
  default_branch_synced_at: null,
  test_requirement: 'none',
  slack_channel_id: null,
  slack_notifications_enabled: false,
  reminder_enabled: false,
  reminder_time: null,
  reminder_days: null,
  reminder_last_sent_at: null,
  reminder_channel_id: null,
  slack_notifications_enabled_at: null,
  slack_deploy_channel_id: null,
  slack_deploy_notify_enabled: false,
  slack_deploy_notify_enabled_at: null,
  nais_apply_enabled: true,
  not_found_in_nais_at: null,
  initial_nais_history_synced_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
}

function makeActivity(
  id: string,
  newImage: string,
  overrides: Partial<NaisApplicationUpdatedActivity> = {},
): NaisApplicationUpdatedActivity {
  return {
    id,
    createdAt: '2026-10-15T10:00:00.000Z',
    actor: 'Rask Elv',
    message: 'Updated application',
    resourceName: 'app-a',
    teamSlug: 'team-a',
    environmentName: 'prod-gcp',
    gitHubActorClaims: {
      actor: 'rask-elv',
      repository: 'navikt/app-a',
      repositoryID: '12345',
      workflow: '.github/workflows/deploy.yml',
      runID: '98765',
      runAttempt: '1',
      checkRunID: '554433',
      workflowSha: 'workflow-sha',
      workflowRef: 'refs/heads/main',
      ref: 'refs/heads/main',
      eventName: 'push',
    },
    changedFields: [{ field: 'spec.image', oldValue: 'old-image', newValue: newImage }],
    ...overrides,
  }
}

describe('materializeNaisApplyDeployments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMonitoredApplicationById).mockResolvedValue(monitoredApp)
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([])
    vi.mocked(upsertNaisApplyDeployment).mockResolvedValue(undefined as never)
    vi.mocked(fetchWorkflowRunHeadSha).mockResolvedValue('a'.repeat(40))
  })

  it('groups image updates by GitHub check run and uses its verified run head SHA', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('activity-1', 'registry/image:sha1', { createdAt: '2026-10-15T10:01:00.000Z' }),
      makeActivity('activity-2', 'registry/image:sha1', { createdAt: '2026-10-15T10:02:00.000Z' }),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(1)

    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledOnce()
    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledWith('navikt', 'app-a', 98765, 1, '12345')
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: 'a'.repeat(40),
        createdAt: new Date('2026-10-15T10:01:00.000Z'),
        detectedGithubOwner: 'navikt',
        detectedGithubRepoName: 'app-a',
        triggerUrl: 'https://github.com/navikt/app-a/actions/runs/98765',
        resources: { nodes: [{ id: expect.any(String), kind: 'Image', name: 'registry/image:sha1' }] },
      }),
    )
  })

  it('keeps image changes without claims as separate unverifiable source records', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('laptop-1', 'registry/image:one', { gitHubActorClaims: null }),
      makeActivity('laptop-2', 'registry/image:two', { gitHubActorClaims: null }),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(2)

    expect(fetchWorkflowRunHeadSha).not.toHaveBeenCalled()
    expect(upsertNaisApplyDeployment).toHaveBeenCalledTimes(2)
    expect(upsertNaisApplyDeployment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commitSha: null, detectedGithubOwner: null, detectedGithubRepoName: null }),
    )
    expect(upsertNaisApplyDeployment.mock.calls[0][0].sourceId).not.toBe(
      upsertNaisApplyDeployment.mock.calls[1][0].sourceId,
    )
  })

  it('does not normalize events without an exact environment match', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('other-env', 'registry/image:one', { environmentName: null }),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(0)

    expect(upsertNaisApplyDeployment).not.toHaveBeenCalled()
  })

  it('does not group different images from the same check run', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('activity-1', 'registry/image:one'),
      makeActivity('activity-2', 'registry/image:two'),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(2)

    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledOnce()
    expect(upsertNaisApplyDeployment).toHaveBeenCalledTimes(2)
  })
})
