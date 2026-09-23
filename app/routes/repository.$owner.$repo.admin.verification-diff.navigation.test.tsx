// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRoutesStub, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/auth.server', () => ({ requireUser: vi.fn() }))
vi.mock('~/lib/repository-resolution.server', () => ({ resolveRepositoryFromParams: vi.fn() }))
vi.mock('~/lib/authorization.server', () => ({ resolveRepositoryAdminAccess: vi.fn() }))
vi.mock('~/db/repositories.server', () => ({
  getRepositoryById: vi.fn(),
  isCurrentOrHistoricalNameForRepositoryId: vi.fn(),
}))
vi.mock('~/db/sync-jobs.server', () => ({ getLatestSyncJobForRepository: vi.fn(), getSyncJobById: vi.fn() }))
vi.mock('~/db/user-github-lookups.server', () => ({ getGithubUserLookups: vi.fn() }))
vi.mock('~/db/connection.server', () => ({ pool: { query: vi.fn() } }))
vi.mock('~/lib/verification', () => ({ reverifyDeployment: vi.fn() }))
vi.mock('~/db/verification-diff.server', () => ({
  getVerificationDiffsForRepository: vi.fn(),
  getApprovedDeploymentsMissingApproverForApps: vi.fn(),
}))
vi.mock('~/lib/logger.server', () => ({ logger: { error: vi.fn() } }))

import RepositoryVerificationDiffPage from './repository.$owner.$repo.admin.verification-diff'

afterEach(cleanup)

const REPO_A_PATH = '/repository/navikt/repo-a/admin/verification-diff'
const REPO_B_PATH = '/repository/navikt/repo-b/admin/verification-diff'

const MISSING_APPROVER_DEPLOYMENT = {
  id: 1,
  commitSha: 'abc1234',
  fourEyesStatus: 'approved_missing_approver',
  environmentName: 'prod-gcp',
  createdAt: '2026-01-01T00:00:00.000Z',
  deployerUsername: 'deployer',
  teamSlug: 'team-a',
  appName: 'some-app',
}

function makeLoaderData(
  repositoryContext: { id: number; githubOwner: string; githubRepoName: string },
  latestJob: unknown,
  options?: { missingApproverDeployments?: unknown[]; latestRefreshJob?: unknown },
) {
  return {
    repositoryContext,
    diffs: [],
    missingApproverDeployments: options?.missingApproverDeployments ?? [],
    userMappings: {},
    lastComputed: null,
    latestJob,
    latestRefreshJob: options?.latestRefreshJob ?? null,
  }
}

function NavigationHarness() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate(REPO_B_PATH)}>
        go-to-repo-b
      </button>
      <RepositoryVerificationDiffPage />
    </>
  )
}

describe('RepositoryVerificationDiffPage — job state does not leak across repository navigation (issue #741)', () => {
  it('stops showing the previous repository\'s "computing" state after navigating to a different repository', async () => {
    const Stub = createRoutesStub([
      {
        path: '/repository/:owner/:repo/admin/verification-diff',
        Component: NavigationHarness,
        loader({ params }: { params: { repo?: string } }) {
          if (params.repo === 'repo-a') {
            return makeLoaderData(
              { id: 1, githubOwner: 'navikt', githubRepoName: 'repo-a' },
              { id: 100, status: 'running' },
            )
          }
          return makeLoaderData({ id: 2, githubOwner: 'navikt', githubRepoName: 'repo-b' }, null)
        },
      },
    ])

    render(<Stub initialEntries={[REPO_A_PATH]} />)

    expect(await screen.findByText('Beregner avvik i bakgrunnen…')).toBeInTheDocument()

    fireEvent.click(screen.getByText('go-to-repo-b'))

    await waitFor(() => expect(screen.queryByText('Beregner avvik i bakgrunnen…')).not.toBeInTheDocument())
  })

  it('ignores a delayed check_compute_status response for the previous repository after navigating away', async () => {
    vi.useFakeTimers()
    try {
      let resolveRepoAStatus: (value: unknown) => void = () => {}
      const repoAStatusPromise = new Promise((resolve) => {
        resolveRepoAStatus = resolve
      })
      const repoASubmissions: FormData[] = []

      const Stub = createRoutesStub([
        {
          path: '/repository/:owner/:repo/admin/verification-diff',
          Component: NavigationHarness,
          loader({ params }: { params: { repo?: string } }) {
            if (params.repo === 'repo-a') {
              return makeLoaderData(
                { id: 1, githubOwner: 'navikt', githubRepoName: 'repo-a' },
                { id: 100, status: 'running' },
              )
            }
            return makeLoaderData({ id: 2, githubOwner: 'navikt', githubRepoName: 'repo-b' }, null)
          },
          action({ request }: { request: Request }) {
            return request.formData().then((formData) => {
              if (formData.get('repository_id') === '1') {
                repoASubmissions.push(formData)
                return repoAStatusPromise
              }
              return null
            })
          },
        },
      ])

      render(<Stub initialEntries={[REPO_A_PATH]} />)
      for (let i = 0; i < 20 && !screen.queryByText('Beregner avvik i bakgrunnen…'); i++) {
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(screen.getByText('Beregner avvik i bakgrunnen…')).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(2100)
      expect(repoASubmissions).toHaveLength(1)

      fireEvent.click(screen.getByText('go-to-repo-b'))
      for (let i = 0; i < 20 && screen.queryByText('Beregner avvik i bakgrunnen…'); i++) {
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(screen.queryByText('Beregner avvik i bakgrunnen…')).not.toBeInTheDocument()

      await act(async () => {
        resolveRepoAStatus({ computeJobStatus: { status: 'completed', result: { errors: 1 } } })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(screen.queryByText('Beregner avvik i bakgrunnen…')).not.toBeInTheDocument()
      expect(screen.queryByText(/Beregningen ble fullført, men ikke alle apper ble prosessert/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a delayed check_refresh_status response for the previous repository after navigating away', async () => {
    vi.useFakeTimers()
    try {
      let resolveRepoAStatus: (value: unknown) => void = () => {}
      const repoAStatusPromise = new Promise((resolve) => {
        resolveRepoAStatus = resolve
      })
      const repoASubmissions: FormData[] = []

      const Stub = createRoutesStub([
        {
          path: '/repository/:owner/:repo/admin/verification-diff',
          Component: NavigationHarness,
          loader({ params }: { params: { repo?: string } }) {
            if (params.repo === 'repo-a') {
              return makeLoaderData({ id: 1, githubOwner: 'navikt', githubRepoName: 'repo-a' }, null, {
                missingApproverDeployments: [MISSING_APPROVER_DEPLOYMENT],
                latestRefreshJob: { id: 200, status: 'running' },
              })
            }
            return makeLoaderData({ id: 2, githubOwner: 'navikt', githubRepoName: 'repo-b' }, null, {
              missingApproverDeployments: [MISSING_APPROVER_DEPLOYMENT],
            })
          },
          action({ request }: { request: Request }) {
            return request.formData().then((formData) => {
              if (formData.get('repository_id') === '1') {
                repoASubmissions.push(formData)
                return repoAStatusPromise
              }
              return null
            })
          },
        },
      ])

      render(<Stub initialEntries={[REPO_A_PATH]} />)
      for (let i = 0; i < 20 && !screen.queryByText('Oppdaterer godkjennere i bakgrunnen…'); i++) {
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(screen.getByText('Oppdaterer godkjennere i bakgrunnen…')).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(2100)
      expect(repoASubmissions).toHaveLength(1)

      fireEvent.click(screen.getByText('go-to-repo-b'))
      for (let i = 0; i < 20 && screen.queryByText('Oppdaterer godkjennere i bakgrunnen…'); i++) {
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(screen.queryByText('Oppdaterer godkjennere i bakgrunnen…')).not.toBeInTheDocument()

      await act(async () => {
        resolveRepoAStatus({ refreshJobStatus: { status: 'completed', result: { errors: 1 } } })
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(screen.queryByText('Oppdaterer godkjennere i bakgrunnen…')).not.toBeInTheDocument()
      expect(screen.queryByText(/Oppdateringen ble fullført, men \d+ deployment\(er\) feilet/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
