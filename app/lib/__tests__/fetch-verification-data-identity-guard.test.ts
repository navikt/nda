import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery, mockFindRepositoryForApp, mockGetEffectiveSettingsForApp, mockIsCommitOnBranch } = vi.hoisted(
  () => ({
    mockPoolQuery: vi.fn(),
    mockFindRepositoryForApp: vi.fn(),
    mockGetEffectiveSettingsForApp: vi.fn(),
    mockIsCommitOnBranch: vi.fn(),
  }),
)

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
  getSingleCommitMessage: vi.fn(),
  isCommitOnBranch: mockIsCommitOnBranch,
  resolveWorkflowRunDetails: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '~/lib/logger.server'
import { fetchVerificationData } from '~/lib/verification/fetch-data.server'

describe('fetchVerificationData identity guard', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
    mockFindRepositoryForApp.mockReset()
    mockGetEffectiveSettingsForApp.mockReset()
    mockIsCommitOnBranch.mockReset()
    vi.mocked(logger.warn).mockReset()

    mockGetEffectiveSettingsForApp.mockResolvedValue({
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
    })
  })

  it('prefers the deployment own github_repo_id over the currently linked repository when they disagree', async () => {
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { status: 'active', github_repo_id: '999' },
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ github_repo_id: '111' }] })
    mockIsCommitOnBranch.mockRejectedValueOnce(new Error('stop-here-test-boundary'))

    await expect(fetchVerificationData(10, 'sha123', 'navikt/repo', 'prod-gcp', 'main', 99)).rejects.toThrow(
      'stop-here-test-boundary',
    )

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not match currently linked repository'))
    expect(mockIsCommitOnBranch).toHaveBeenCalledWith('navikt', 'repo', 'sha123', 'main')
  })

  it('proceeds using the deployment own github_repo_id when the repository is no longer linked at all', async () => {
    mockFindRepositoryForApp.mockResolvedValue({ repository: null })
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ github_repo_id: '111' }] })
    mockIsCommitOnBranch.mockRejectedValueOnce(new Error('stop-here-test-boundary'))

    await expect(fetchVerificationData(11, 'sha456', 'navikt/repo', 'prod-gcp', 'main', 99)).rejects.toThrow(
      'stop-here-test-boundary',
    )

    expect(logger.warn).not.toHaveBeenCalled()
    expect(mockIsCommitOnBranch).toHaveBeenCalledWith('navikt', 'repo', 'sha456', 'main')
  })

  it('proceeds normally when the deployment has no persisted github_repo_id yet', async () => {
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { status: 'active', github_repo_id: '999' },
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ github_repo_id: null }] })
    mockIsCommitOnBranch.mockRejectedValueOnce(new Error('stop-here-test-boundary'))

    await expect(fetchVerificationData(12, 'sha789', 'navikt/repo', 'prod-gcp', 'main', 99)).rejects.toThrow(
      'stop-here-test-boundary',
    )

    expect(mockIsCommitOnBranch).toHaveBeenCalledWith('navikt', 'repo', 'sha789', 'main')
  })

  it('proceeds normally when the deployment own github_repo_id matches the currently linked repository', async () => {
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { status: 'active', github_repo_id: '999' },
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ github_repo_id: '999' }] })
    mockIsCommitOnBranch.mockRejectedValueOnce(new Error('stop-here-test-boundary'))

    await expect(fetchVerificationData(13, 'sha999', 'navikt/repo', 'prod-gcp', 'main', 99)).rejects.toThrow(
      'stop-here-test-boundary',
    )

    expect(mockIsCommitOnBranch).toHaveBeenCalledWith('navikt', 'repo', 'sha999', 'main')
  })
})
