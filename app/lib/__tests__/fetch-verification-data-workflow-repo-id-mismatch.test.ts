import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPoolQuery,
  mockFindRepositoryForApp,
  mockGetEffectiveSettingsForApp,
  mockIsCommitOnBranch,
  mockResolveWorkflowRunDetails,
  mockGetSingleCommitMessage,
  mockGetPreviousDeployment,
  mockPreferRootApprovedSibling,
  mockFetchDeployedPrData,
  mockFetchWorkflowTriggerConfig,
  mockGetCachedCommitChecks,
  mockFetchCommitChecks,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockFindRepositoryForApp: vi.fn(),
  mockGetEffectiveSettingsForApp: vi.fn(),
  mockIsCommitOnBranch: vi.fn(),
  mockResolveWorkflowRunDetails: vi.fn(),
  mockGetSingleCommitMessage: vi.fn(),
  mockGetPreviousDeployment: vi.fn(),
  mockPreferRootApprovedSibling: vi.fn(),
  mockFetchDeployedPrData: vi.fn(),
  mockFetchWorkflowTriggerConfig: vi.fn(),
  mockGetCachedCommitChecks: vi.fn(),
  mockFetchCommitChecks: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: mockFindRepositoryForApp,
  LATEST_ACTIVE_REPOSITORY_LINK_SQL: '',
}))

vi.mock('~/db/repositories.server', () => ({
  getEffectiveSettingsForApp: mockGetEffectiveSettingsForApp,
  getEffectiveSettingsForRepository: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getSingleCommitMessage: mockGetSingleCommitMessage,
  isCommitOnBranch: mockIsCommitOnBranch,
  resolveWorkflowRunDetails: mockResolveWorkflowRunDetails,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('~/lib/verification/fetch-data/previous-deployment.server', () => ({
  getPreviousDeployment: mockGetPreviousDeployment,
  preferRootApprovedSibling: mockPreferRootApprovedSibling,
}))

vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({
  fetchDeployedPrData: mockFetchDeployedPrData,
}))

vi.mock('~/lib/verification/fetch-data/workflow-triggers.server', () => ({
  fetchWorkflowTriggerConfig: mockFetchWorkflowTriggerConfig,
}))

vi.mock('~/lib/verification/fetch-data/commit-checks.server', () => ({
  getCachedCommitChecks: mockGetCachedCommitChecks,
  fetchCommitChecks: mockFetchCommitChecks,
}))

vi.mock('~/lib/verification/fetch-data/commits-between.server', () => ({
  fetchCommitsBetween: vi.fn(),
}))

import { logger } from '~/lib/logger.server'
import { fetchVerificationData } from '~/lib/verification/fetch-data.server'

describe('fetchVerificationData workflow-run resolved github_repo_id mismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetEffectiveSettingsForApp.mockResolvedValue({
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
    })
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { status: 'active', github_repo_id: '999' },
    })
    // ownIdRows lookup — deployment has no persisted github_repo_id yet, so the early
    // own-id guard doesn't trigger and the function proceeds to resolve one from the run.
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ github_repo_id: null }] })
    mockIsCommitOnBranch.mockResolvedValue(true)
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockPreferRootApprovedSibling.mockResolvedValue(null)
    mockFetchDeployedPrData.mockResolvedValue({
      deployedPr: null,
      mismatchedBaseBranches: [],
      mismatchedPrNumbers: [],
    })
    mockGetSingleCommitMessage.mockResolvedValue(undefined)
    mockGetCachedCommitChecks.mockResolvedValue({ isCached: false })
    mockFetchCommitChecks.mockResolvedValue({ commitChecks: undefined, attempted: false })
  })

  it('discards a resolved github_repo_id that mismatches the currently linked repository', async () => {
    mockFetchWorkflowTriggerConfig.mockResolvedValue({
      config: undefined,
      repositoryId: 555,
      headBranch: 'feature-branch',
      liveFetchPerformed: true,
    })

    const result = await fetchVerificationData(
      20,
      'sha-mismatch',
      'navikt/repo',
      'prod-gcp',
      'main',
      99,
      undefined,
      'https://github.com/navikt/repo/actions/runs/555',
    )

    expect(result.detectedGithubRepoId).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match currently linked repository'))
  })

  it('keeps a resolved github_repo_id that matches the currently linked repository', async () => {
    mockFetchWorkflowTriggerConfig.mockResolvedValue({
      config: undefined,
      repositoryId: 999,
      headBranch: 'feature-branch',
      liveFetchPerformed: true,
    })

    const result = await fetchVerificationData(
      21,
      'sha-match',
      'navikt/repo',
      'prod-gcp',
      'main',
      99,
      undefined,
      'https://github.com/navikt/repo/actions/runs/999',
    )

    expect(result.detectedGithubRepoId).toBe(999)
  })
})
