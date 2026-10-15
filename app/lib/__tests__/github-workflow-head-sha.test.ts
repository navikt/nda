import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getWorkflowRunRawSnapshotData,
  hasRecentWorkflowRunAttemptShaFailure,
  recordWorkflowRunAttemptShaFailure,
  saveWorkflowRunRawSnapshot,
  getGitHubClient,
  getGitHubRateLimitRemaining,
} = vi.hoisted(() => ({
  getWorkflowRunRawSnapshotData: vi.fn(),
  hasRecentWorkflowRunAttemptShaFailure: vi.fn(),
  recordWorkflowRunAttemptShaFailure: vi.fn(),
  saveWorkflowRunRawSnapshot: vi.fn(),
  getGitHubClient: vi.fn(),
  getGitHubRateLimitRemaining: vi.fn(),
}))

vi.mock('~/db/github-data.server', () => ({
  getWorkflowRunRawSnapshotData,
  hasRecentWorkflowRunAttemptShaFailure,
  recordWorkflowRunAttemptShaFailure,
  saveWorkflowRunRawSnapshot,
}))
vi.mock('../github/client.server', () => ({
  GITHUB_RATE_LIMIT_SAFETY_BUFFER: 200,
  getGitHubClient,
  getGitHubRateLimitError: vi.fn(),
  getGitHubRateLimitRemaining,
}))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { fetchWorkflowRunHeadSha } from '../github/git.server'

const headSha = 'a'.repeat(40)
const getWorkflowRunAttempt = vi.fn()
const run = {
  repository: { id: 12345 },
  run_attempt: 2,
  head_sha: headSha,
  workflow_sha: 'b'.repeat(40),
}

describe('fetchWorkflowRunHeadSha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWorkflowRunClientSetup()
    vi.mocked(getWorkflowRunRawSnapshotData).mockResolvedValue(null)
    vi.mocked(hasRecentWorkflowRunAttemptShaFailure).mockResolvedValue(false)
    vi.mocked(recordWorkflowRunAttemptShaFailure).mockResolvedValue(undefined)
    vi.mocked(saveWorkflowRunRawSnapshot).mockResolvedValue(1)
    vi.mocked(getGitHubRateLimitRemaining).mockReturnValue(null)
    getWorkflowRunAttempt.mockResolvedValue({ data: run, headers: {} })
  })

  it('uses the claimed Actions run attempt head SHA after verifying repository identity', async () => {
    await expect(fetchWorkflowRunHeadSha('navikt', 'app-a', 98765, 2, '12345')).resolves.toBe(headSha)

    expect(getWorkflowRunAttempt).toHaveBeenCalledWith({
      owner: 'navikt',
      repo: 'app-a',
      run_id: 98765,
      attempt_number: 2,
    })
    expect(getWorkflowRunRawSnapshotData).toHaveBeenCalledWith('12345', 98765, 2)
    expect(saveWorkflowRunRawSnapshot).toHaveBeenCalledWith('navikt', 'app-a', '12345', 98765, run, expect.any(Object))
  })

  it('does not use an Actions run from another repository or attempt', async () => {
    getWorkflowRunAttempt.mockResolvedValueOnce({
      data: { ...run, repository: { id: 99999 } },
      headers: {},
    })
    await expect(fetchWorkflowRunHeadSha('navikt', 'app-a', 98765, 2, '12345')).resolves.toBeNull()

    getWorkflowRunAttempt.mockResolvedValueOnce({
      data: { ...run, run_attempt: 1 },
      headers: {},
    })
    await expect(fetchWorkflowRunHeadSha('navikt', 'app-a', 98765, 2, '12345')).resolves.toBeNull()

    expect(saveWorkflowRunRawSnapshot).not.toHaveBeenCalled()
  })

  it('records a missing attempt and avoids retrying it on every poll', async () => {
    getWorkflowRunAttempt.mockRejectedValueOnce({ status: 404, message: 'Not Found' })

    await expect(fetchWorkflowRunHeadSha('navikt', 'app-a', 98765, 2, '12345')).resolves.toBeNull()
    expect(recordWorkflowRunAttemptShaFailure).toHaveBeenCalledWith('12345', 98765, 2)

    vi.mocked(hasRecentWorkflowRunAttemptShaFailure).mockResolvedValue(true)
    await expect(fetchWorkflowRunHeadSha('navikt', 'app-a', 98765, 2, '12345')).resolves.toBeNull()
    expect(getWorkflowRunAttempt).toHaveBeenCalledOnce()
  })

  it('reuses a cached head SHA only for the matching repository and attempt', async () => {
    vi.mocked(getWorkflowRunRawSnapshotData).mockResolvedValue(run)

    await expect(fetchWorkflowRunHeadSha('navikt', 'app-a', 98765, 2, '12345')).resolves.toBe(headSha)

    expect(getWorkflowRunAttempt).not.toHaveBeenCalled()
    expect(saveWorkflowRunRawSnapshot).not.toHaveBeenCalled()
  })
})

function getWorkflowRunClientSetup() {
  getGitHubClient.mockReturnValue({ actions: { getWorkflowRunAttempt } })
}
