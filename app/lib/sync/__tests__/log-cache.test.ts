import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, getRepositoryIdentityById, download, logExists, uploadLog, downloadLog } = vi.hoisted(() => ({
  query: vi.fn(),
  getRepositoryIdentityById: vi.fn(),
  download: vi.fn(),
  logExists: vi.fn(),
  uploadLog: vi.fn(),
  downloadLog: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({ pool: { query } }))
vi.mock('~/lib/github', () => ({
  getGitHubClient: () => ({ actions: { downloadJobLogsForWorkflowRun: download } }),
}))
vi.mock('~/lib/github/git.server', () => ({ getRepositoryIdentityById }))
vi.mock('~/lib/gcs.server', () => ({ isGcsConfigured: () => true, logExists, uploadLog, downloadLog }))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

import { loader } from '~/routes/api/checks.logs'
import { cacheCheckLogs } from '../log-cache.server'

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    deployment_source: 'nais_apply',
    github_repo_id: '123',
    repository_full_name: 'navikt/reused-name',
    github_pr_data: { checks: [{ id: 50, name: 'build', status: 'completed' }] },
    commit_checks_data: null,
    ...overrides,
  }
}

describe('Apply check log repository identity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    query.mockResolvedValue({ rows: [] })
    getRepositoryIdentityById.mockResolvedValue({ id: 123, owner: 'navikt', name: 'renamed-repository' })
    logExists.mockResolvedValue(false)
    download.mockResolvedValue({ data: 'build output' })
  })

  it('downloads Apply logs from the current name of the associated repository only', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [deployment()] })

    expect((await cacheCheckLogs(7)).cached).toBe(1)

    expect(getRepositoryIdentityById).toHaveBeenCalledExactlyOnceWith(123)
    expect(download).toHaveBeenCalledExactlyOnceWith({ owner: 'navikt', repo: 'renamed-repository', job_id: 50 })
    expect(uploadLog).toHaveBeenCalledWith('navikt', 'reused-name', 50, 'build output')
    expect(logExists).toHaveBeenCalledWith('navikt', 'reused-name', 50)
    expect(query.mock.calls[1][0]).toContain("d.deployment_source != 'nais_apply'")
    expect(query.mock.calls[1][0]).toContain('r.id = d.repository_id')
  })

  it('serves archived Apply logs using the claim-time name after the GitHub repository is renamed', async () => {
    const archive = new Map<string, string>()
    uploadLog.mockImplementation(async (owner: string, repo: string, id: number, logs: string) => {
      archive.set(`${owner}/${repo}/${id}`, logs)
    })
    logExists.mockImplementation(async (owner: string, repo: string, id: number) =>
      archive.has(`${owner}/${repo}/${id}`),
    )
    downloadLog.mockImplementation(async (owner: string, repo: string, id: number) =>
      archive.get(`${owner}/${repo}/${id}`),
    )
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [deployment()] })

    expect((await cacheCheckLogs(7)).cached).toBe(1)
    download.mockRejectedValue(new Error('GitHub logs have expired'))
    const url = new URL('http://localhost/api/checks/logs?owner=navikt&repo=reused-name&job_id=50')
    const response = await loader({ url, request: new Request(url) } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ logs: 'build output', source: 'cached' })
    expect(download).toHaveBeenCalledOnce()
  })

  it.each([null, { id: 999, owner: 'navikt', name: 'wrong-repository' }])(
    'leaves logs retryable when repository resolution returns %s',
    async (identity) => {
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [deployment()] })
      getRepositoryIdentityById.mockResolvedValue(identity)

      const result = await cacheCheckLogs(7)

      expect(result.cached).toBe(0)
      expect(result.diagnostics.skippedNoRepo).toBe(1)
      expect(download).not.toHaveBeenCalled()
      expect(query).toHaveBeenCalledTimes(2)
    },
  )

  it('does not fall back to app links when the Apply repository association is missing', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [deployment({ github_repo_id: null })] })

    expect((await cacheCheckLogs(7)).cached).toBe(0)
    expect(getRepositoryIdentityById).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('resolves each Apply repository only once per polling pass', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [deployment(), deployment({ id: 11 })] })

    expect((await cacheCheckLogs(7)).cached).toBe(2)
    expect(getRepositoryIdentityById).toHaveBeenCalledOnce()
  })

  it('preserves the legacy repository path without resolving Apply identity', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [deployment({ deployment_source: 'nais_deployment' })] })

    expect((await cacheCheckLogs(7)).cached).toBe(1)
    expect(getRepositoryIdentityById).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledExactlyOnceWith({ owner: 'navikt', repo: 'reused-name', job_id: 50 })
  })
})
