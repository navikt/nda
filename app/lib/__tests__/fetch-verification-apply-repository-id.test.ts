import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  poolQuery,
  findRepositoryForApp,
  getEffectiveSettingsForRepository,
  getEffectiveSettingsForApp,
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
vi.mock('~/db/repositories.server', () => ({ getEffectiveSettingsForRepository, getEffectiveSettingsForApp }))
vi.mock('~/lib/github', () => ({
  getBranchFromWorkflowRun,
  getSingleCommitMessage,
  isCommitOnBranch,
}))
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
    poolQuery.mockResolvedValue({ rows: [{ repository_id: 77 }] })
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
    })
  })
})
