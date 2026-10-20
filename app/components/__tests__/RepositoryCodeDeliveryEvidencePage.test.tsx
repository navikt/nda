import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it } from 'vitest'
import type { RepositoryCodeDeliveryEvidence } from '~/db/repository-code-delivery-overview.server'
import { RepositoryCodeDeliveryEvidencePage } from '../RepositoryCodeDeliveryEvidencePage'

it('shows saved progress after the first sync attempt is deferred without counting as a failure', () => {
  const delivery: RepositoryCodeDeliveryEvidence = {
    id: 17,
    base_sha: '1'.repeat(40),
    head_sha: '2'.repeat(40),
    created_at: new Date('2026-10-20T10:00:00Z'),
    assessment_sync: {
      status: 'retry_wait',
      attempt_count: 0,
      next_attempt_at: '2026-10-20T10:05:00Z',
      locked_until: null,
      completed_at: null,
      completed_assessment_version: 0,
      last_error: 'GitHub rate limit',
      updated_at: '2026-10-20T10:00:00Z',
      completed_association_snapshots: 2,
      completed_pull_request_snapshots: 1,
      stack_parent_pull_requests: 0,
    },
    interval_assessment: {
      state: 'unavailable',
      comparisonComplete: false,
      defaultBranch: 'main',
      totalCommits: null,
      listedCommits: 0,
      omittedCommits: 0,
      summary: { covered: 0, notCovered: 0, unknown: 0 },
      commits: [],
    },
    page: 1,
    totalPages: 1,
    totalEvidenceEntries: 0,
    deployments: [],
  }
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RepositoryCodeDeliveryEvidencePage
          repository={{ id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' }}
          delivery={delivery}
          approvalAssessment={{
            status: 'incomplete',
            totalCommits: null,
            listedCommits: 0,
            omittedCommits: 0,
            commits: [],
          }}
          manualApprovalHistory={[]}
          userMappings={{}}
        />
      ),
    },
  ])

  const markup = renderToStaticMarkup(<RouterProvider router={router} />)

  expect(markup).toContain('Venter på nytt forsøk')
  expect(markup).toContain('Synkede commit-assosiasjoner: 2')
  expect(markup).toContain('Synkede PR-er: 1')
  expect(markup).toContain('Stack-foreldre: 0')
  expect(markup).toContain('GitHub rate limit')
})
