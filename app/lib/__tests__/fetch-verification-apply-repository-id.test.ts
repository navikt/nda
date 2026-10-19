import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  poolQuery,
  findRepositoryForApp,
  getEffectiveSettingsForRepository,
  getEffectiveSettingsForApp,
  getRepositoryIdByGithubRepoId,
  getRepositoryIdentityById,
  getBranchFromWorkflowRun,
  getSingleCommitMessage,
  isCommitOnBranch,
  getPreviousDeployment,
  preferRootApprovedSibling,
  fetchDeployedPrData,
  fetchCommitsBetween,
  fetchWorkflowTriggerConfig,
  fetchCommitChecks,
  getCachedCommitChecks,
} = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  findRepositoryForApp: vi.fn(),
  getEffectiveSettingsForRepository: vi.fn(),
  getEffectiveSettingsForApp: vi.fn(),
  getRepositoryIdByGithubRepoId: vi.fn(),
  getRepositoryIdentityById: vi.fn(),
  getBranchFromWorkflowRun: vi.fn(),
  getSingleCommitMessage: vi.fn(),
  isCommitOnBranch: vi.fn(),
  getPreviousDeployment: vi.fn(),
  preferRootApprovedSibling: vi.fn(),
  fetchDeployedPrData: vi.fn(),
  fetchCommitsBetween: vi.fn(),
  fetchWorkflowTriggerConfig: vi.fn(),
  fetchCommitChecks: vi.fn(),
  getCachedCommitChecks: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({ pool: { query: poolQuery } }))
vi.mock('~/db/application-repositories.server', () => ({ findRepositoryForApp }))
vi.mock('~/db/repositories.server', () => ({
  getEffectiveSettingsForRepository,
  getEffectiveSettingsForApp,
  getRepositoryIdByGithubRepoId,
}))
vi.mock('~/lib/github', () => ({
  getBranchFromWorkflowRun,
  getSingleCommitMessage,
  isCommitOnBranch,
}))
vi.mock('~/lib/github/git.server', () => ({ getRepositoryIdentityById }))
vi.mock('~/lib/four-eyes-status', () => ({ APPROVED_STATUSES_SQL: "'approved'" }))
vi.mock('../verification/fetch-data/previous-deployment.server', () => ({
  getPreviousDeployment,
  preferRootApprovedSibling,
}))
vi.mock('../verification/fetch-data/commit-checks.server', () => ({
  fetchCommitChecks,
  getCachedCommitChecks,
}))
vi.mock('../verification/fetch-data/commits-between.server', () => ({ fetchCommitsBetween }))
vi.mock('../verification/fetch-data/pr-data.server', () => ({ fetchDeployedPrData: fetchDeployedPrData }))
vi.mock('../verification/fetch-data/workflow-triggers.server', () => ({ fetchWorkflowTriggerConfig }))
vi.mock('../verification/branch-mismatch', () => ({ buildBranchMismatch: vi.fn(() => null) }))

import { fetchVerificationData } from '../verification/fetch-data.server'

describe('fetchVerificationData for renamed Apply repositories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [{ deployment_source: 'nais_deployment', repository_id: 77 }] })
    findRepositoryForApp.mockResolvedValue({
      repository: {
        github_repo_id: '12345',
        status: 'active',
        redirects_to_owner: null,
        redirects_to_repo: null,
      },
      effectiveOwner: 'navikt',
      effectiveRepo: 'current-name',
      isRedirected: false,
    })
    getEffectiveSettingsForRepository.mockResolvedValue({
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
    })
    getRepositoryIdByGithubRepoId.mockResolvedValue(77)
    getRepositoryIdentityById.mockResolvedValue({
      id: 12345,
      owner: 'navikt',
      name: 'current-name',
      defaultBranch: 'main',
    })
    getEffectiveSettingsForApp.mockResolvedValue({
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
    })
    isCommitOnBranch.mockResolvedValue(true)
    getPreviousDeployment.mockResolvedValue(null)
    preferRootApprovedSibling.mockResolvedValue(null)
    fetchDeployedPrData.mockResolvedValue({
      deployedPr: null,
      mismatchedBaseBranches: [],
      mismatchedPrNumbers: [],
      derivedFromRaw: false,
    })
    getBranchFromWorkflowRun.mockResolvedValue(null)
    fetchWorkflowTriggerConfig.mockResolvedValue(null)
    getSingleCommitMessage.mockResolvedValue(null)
    getCachedCommitChecks.mockResolvedValue({ isCached: true, commitChecks: null })
  })

  it('authorizes and fetches verification data through the deployment repository ID', async () => {
    const result = await fetchVerificationData(100, 'a'.repeat(40), 'navikt/old-name', 'prod-gcp', 'main', 7)

    expect(findRepositoryForApp).toHaveBeenCalledWith(7, 'navikt', 'old-name', 77)
    expect(isCommitOnBranch).toHaveBeenCalledWith('navikt', 'current-name', 'a'.repeat(40), 'main')
    expect(fetchDeployedPrData).toHaveBeenCalledWith('navikt', 'current-name', 'a'.repeat(40), 'main', undefined)
    expect(result).toMatchObject({
      repository: 'navikt/current-name',
      repositoryStatus: 'active',
      previousDeployment: null,
      previousDeploymentLookupFailed: false,
    })
  })

  it('reports a failed history lookup when the linked repository lacks canonical metadata', async () => {
    getRepositoryIdByGithubRepoId.mockResolvedValueOnce(null)

    const result = await fetchVerificationData(100, 'a'.repeat(40), 'navikt/old-name', 'prod-gcp', 'main', 7)

    expect(getRepositoryIdByGithubRepoId).toHaveBeenCalledWith('12345')
    expect(getPreviousDeployment).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      repositoryStatus: 'active',
      previousDeployment: null,
      previousDeploymentLookupFailed: true,
    })
  })

  it('rejects Apply verification without a stored repository ID even when a caller supplies one', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ deployment_source: 'nais_apply', repository_id: null }] })

    await expect(
      fetchVerificationData(100, 'a'.repeat(40), 'navikt/old-name', 'prod-gcp', 'main', 7, undefined, undefined, 77),
    ).rejects.toThrow('without an immutable repository association')

    expect(findRepositoryForApp).not.toHaveBeenCalled()
    expect(isCommitOnBranch).not.toHaveBeenCalled()
  })

  it('uses the GitHub default branch for the immutable Apply repository, not the caller app branch', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ deployment_source: 'nais_apply', repository_id: 77 }] })

    await fetchVerificationData(100, 'a'.repeat(40), 'navikt/old-name', 'prod-gcp', 'wrong-app-branch', 7)

    expect(getRepositoryIdentityById).toHaveBeenCalledWith(12345)
    expect(isCommitOnBranch).toHaveBeenCalledWith('navikt', 'current-name', 'a'.repeat(40), 'main')
    expect(fetchDeployedPrData).toHaveBeenCalledWith('navikt', 'current-name', 'a'.repeat(40), 'main', undefined)
  })

  it('scopes nearby verification evidence to the candidate deployment repository', async () => {
    getPreviousDeployment.mockResolvedValue({
      id: 99,
      commitSha: 'b'.repeat(40),
      createdAt: '2026-01-01T00:00:00.000Z',
      monitoredAppId: 7,
      fourEyesStatus: 'approved',
    })
    preferRootApprovedSibling.mockImplementation(async (candidate) => candidate)
    fetchCommitsBetween.mockResolvedValue({
      commitsBetween: [],
      compareSummary: { noDiffDetected: false },
      derivedFromRaw: false,
    })
    poolQuery.mockResolvedValueOnce({
      rows: [{ deployment_source: 'nais_deployment', repository_id: 77 }],
    })
    poolQuery.mockResolvedValue({ rows: [] })

    await fetchVerificationData(100, 'a'.repeat(40), 'navikt/old-name', 'prod-gcp', 'main', 7, undefined, undefined, 77)

    expect(poolQuery).toHaveBeenCalledTimes(3)
    expect(poolQuery.mock.calls[1][0]).toContain(
      'd.repository_id = (SELECT id FROM repositories WHERE github_repo_id = $3)',
    )
    expect(poolQuery.mock.calls[2][0]).toContain(
      'd.repository_id = (SELECT id FROM repositories WHERE github_repo_id = $2)',
    )
  })
})
