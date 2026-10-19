import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchVerificationData } from '~/lib/verification/fetch-data.server'
import { verifyDeployment } from '~/lib/verification/verify'
import { seedApp, seedApplicationRepository, seedDeployment, truncateAllTables } from './helpers'

const {
  fetchCommitChecks,
  fetchDeployedPrData,
  fetchWorkflowTriggerConfig,
  getBranchFromWorkflowRun,
  getCachedCommitChecks,
  getPreviousDeployment,
  getSingleCommitMessage,
  isCommitOnBranch,
} = vi.hoisted(() => ({
  fetchCommitChecks: vi.fn(),
  fetchDeployedPrData: vi.fn(),
  fetchWorkflowTriggerConfig: vi.fn(),
  getBranchFromWorkflowRun: vi.fn(),
  getCachedCommitChecks: vi.fn(),
  getPreviousDeployment: vi.fn(),
  getSingleCommitMessage: vi.fn(),
  isCommitOnBranch: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getBranchFromWorkflowRun,
  getSingleCommitMessage,
  isCommitOnBranch,
}))
vi.mock('~/lib/verification/fetch-data/commit-checks.server', () => ({
  fetchCommitChecks,
  getCachedCommitChecks,
}))
vi.mock('~/lib/verification/fetch-data/previous-deployment.server', () => ({
  getPreviousDeployment,
  preferRootApprovedSibling: vi.fn(async (deployment) => deployment),
}))
vi.mock('~/lib/verification/fetch-data/commits-between.server', () => ({ fetchCommitsBetween: vi.fn() }))
vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({ fetchDeployedPrData }))
vi.mock('~/lib/verification/fetch-data/workflow-triggers.server', () => ({ fetchWorkflowTriggerConfig }))

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchCommitChecks.mockResolvedValue({ commitChecks: null, attempted: true })
  fetchDeployedPrData.mockResolvedValue({
    deployedPr: null,
    mismatchedBaseBranches: [],
    mismatchedPrNumbers: [],
    derivedFromRaw: false,
  })
  fetchWorkflowTriggerConfig.mockResolvedValue(null)
  getBranchFromWorkflowRun.mockResolvedValue(null)
  getCachedCommitChecks.mockResolvedValue({ isCached: true, commitChecks: null })
  getPreviousDeployment.mockResolvedValue(null)
  getSingleCommitMessage.mockResolvedValue(null)
  isCommitOnBranch.mockResolvedValue(true)
})

describe('verification with missing canonical repository metadata', () => {
  it('does not treat legacy history as a baseline when the active link has no canonical repository row', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-a',
      githubRepoId: '12345',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      githubOwner: 'navikt',
      githubRepo: 'app-a',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      commitSha: 'a'.repeat(40),
    })
    const currentDeploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      githubOwner: 'navikt',
      githubRepo: 'app-a',
      createdAt: new Date('2025-02-01T00:00:00Z'),
      commitSha: 'b'.repeat(40),
    })

    const input = await fetchVerificationData(
      currentDeploymentId,
      'b'.repeat(40),
      'navikt/app-a',
      'prod',
      'main',
      appId,
    )

    expect(getPreviousDeployment).not.toHaveBeenCalled()
    expect(input).toMatchObject({
      repositoryStatus: 'active',
      previousDeployment: null,
      previousDeploymentLookupFailed: true,
    })
    expect(verifyDeployment(input).status).toBe('error')
  })
})
