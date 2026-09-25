import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockCountDeploymentsPendingGithubRepoIdBackfill, mockBackfillDeploymentGithubRepoIds } =
  vi.hoisted(() => ({
    mockRequireAdmin: vi.fn(),
    mockCountDeploymentsPendingGithubRepoIdBackfill: vi.fn(),
    mockBackfillDeploymentGithubRepoIds: vi.fn(),
  }))

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/lib/github', () => ({
  countDeploymentsPendingGithubRepoIdBackfill: mockCountDeploymentsPendingGithubRepoIdBackfill,
  backfillDeploymentGithubRepoIds: mockBackfillDeploymentGithubRepoIds,
}))

import { action, loader } from './backfill-github-repo-id'

function makeRequest(): Request {
  return new Request('http://localhost/admin/backfill-github-repo-id', { method: 'POST' })
}

describe('backfill-github-repo-id admin route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
  })

  describe('loader', () => {
    it('checks admin access before reading the pending count', async () => {
      mockCountDeploymentsPendingGithubRepoIdBackfill.mockResolvedValue(7)

      const result = await loader({ request: makeRequest() } as never)

      expect(mockRequireAdmin).toHaveBeenCalledWith(expect.any(Request))
      expect(result).toEqual({ pendingCount: 7 })
    })

    it('propagates the admin guard rejection without reading the pending count', async () => {
      mockRequireAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }))

      await expect(loader({ request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

      expect(mockCountDeploymentsPendingGithubRepoIdBackfill).not.toHaveBeenCalled()
    })
  })

  describe('action', () => {
    it('checks admin access before running the backfill', async () => {
      mockRequireAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }))

      await expect(action({ request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

      expect(mockBackfillDeploymentGithubRepoIds).not.toHaveBeenCalled()
    })

    it('reports a no-op message when there is nothing to process', async () => {
      mockBackfillDeploymentGithubRepoIds.mockResolvedValue({
        processed: 0,
        resolved: 0,
        unresolved: 0,
        transientFailures: 0,
        remaining: 0,
        truncated: false,
        alreadyRunning: false,
      })

      const result = await action({ request: makeRequest() } as never)

      expect(result.success).toBe('Ingen leveranser å behandle.')
      expect(result.result.processed).toBe(0)
    })

    it('reports resolved/unresolved/transient counts when rows were processed', async () => {
      mockBackfillDeploymentGithubRepoIds.mockResolvedValue({
        processed: 3,
        resolved: 1,
        unresolved: 1,
        transientFailures: 1,
        remaining: 5,
        truncated: true,
        alreadyRunning: false,
      })

      const result = await action({ request: makeRequest() } as never)

      expect(result.success).toBe(
        'Behandlet 3 leveranser: 1 fikk github_repo_id, 1 forble NULL, 1 feilet midlertidig (prøves igjen ved neste kjøring).',
      )
      expect(result.result).toEqual({
        processed: 3,
        resolved: 1,
        unresolved: 1,
        transientFailures: 1,
        remaining: 5,
        truncated: true,
        alreadyRunning: false,
      })
    })

    it('reports an already-running message without treating it as a completed no-op run', async () => {
      mockBackfillDeploymentGithubRepoIds.mockResolvedValue({
        processed: 0,
        resolved: 0,
        unresolved: 0,
        transientFailures: 0,
        remaining: 42,
        truncated: true,
        alreadyRunning: true,
      })

      const result = await action({ request: makeRequest() } as never)

      expect(result.success).toBe('Backfillen kjører allerede (f.eks. i en annen fane) — prøv igjen om litt.')
      expect(result.result.alreadyRunning).toBe(true)
    })
  })
})
