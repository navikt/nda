import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryCodeDeliveryEvidencePage } from '~/components/RepositoryCodeDeliveryEvidencePage'

const meta: Meta<typeof RepositoryCodeDeliveryEvidencePage> = {
  title: 'Features/RepositoryAdmin/RepositoryCodeDeliveryEvidencePage',
  component: RepositoryCodeDeliveryEvidencePage,
  args: { manualApprovalHistory: [] },
}
export default meta
type Story = StoryObj<typeof RepositoryCodeDeliveryEvidencePage>

export const WithStoredReviews = {
  args: {
    repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
    approvalAssessment: {
      status: 'approved',
      totalCommits: 1,
      listedCommits: 1,
      omittedCommits: 0,
      commits: [{ sha: '2'.repeat(40), status: 'covered', reason: 'approved_pr' }],
    },
    userMappings: { 'rask-elv': { display_name: 'Rask Elv', nav_ident: 'Z990010' } },
    delivery: {
      id: 3,
      base_sha: '1'.repeat(40),
      head_sha: '2'.repeat(40),
      created_at: new Date('2026-10-03T10:00:00.000Z'),
      assessment_sync: {
        status: 'completed',
        attempt_count: 1,
        next_attempt_at: null,
        locked_until: null,
        completed_at: '2026-10-03T11:30:00.000Z',
        completed_assessment_version: 1,
        last_error: null,
        updated_at: '2026-10-03T11:30:00.000Z',
        completed_association_snapshots: 1,
        completed_pull_request_snapshots: 1,
        stack_parent_pull_requests: 0,
      },
      page: 1,
      totalPages: 1,
      totalEvidenceEntries: 1,
      interval_assessment: {
        state: 'complete',
        comparisonComplete: true,
        defaultBranch: 'main',
        totalCommits: 1,
        listedCommits: 1,
        omittedCommits: 0,
        summary: { covered: 1, notCovered: 0, unknown: 0 },
        commits: [
          {
            sha: '2'.repeat(40),
            message: 'Add delivery evidence',
            authorUsername: 'rask-elv',
            authorLogin: 'rask-elv',
            htmlUrl: `https://github.com/navikt/glad-fjord/commit/${'2'.repeat(40)}`,
            pullRequestNumber: 42,
            status: 'covered',
            reason: 'approved_review',
          },
        ],
      },
      deployments: [
        {
          id: 17,
          deployed_at: new Date('2026-10-03T12:00:00.000Z'),
          team_slug: 'team-fjord',
          environment_name: 'prod-gcp',
          app_name: 'glad-fjord-api',
          verification_runs: [
            {
              id: 8,
              run_at: new Date('2026-10-03T12:05:00.000Z'),
              schema_version: 5,
              status: 'approved',
              comparison_range: { baseSha: '1'.repeat(40), headSha: '2'.repeat(40) },
              comparison_range_invalid: false,
              review_snapshots: [
                {
                  id: 12,
                  pr_number: 42,
                  schema_version: 5,
                  fetched_at: new Date('2026-10-03T12:04:00.000Z'),
                  source: 'github',
                  github_available: true,
                  reviews: [
                    {
                      id: 1,
                      username: 'rask-elv',
                      state: 'APPROVED',
                      submittedAt: '2026-10-03T09:00:00.000Z',
                      commitSha: '2'.repeat(40),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
} satisfies Story

export const WithManualApproval: Story = {
  args: {
    ...WithStoredReviews.args,
    approvalAssessment: {
      status: 'approved',
      totalCommits: 1,
      listedCommits: 1,
      omittedCommits: 0,
      commits: [{ sha: '2'.repeat(40), status: 'covered', reason: 'manual_approval' }],
    },
    delivery: {
      ...WithStoredReviews.args.delivery,
      interval_assessment: {
        state: 'complete',
        comparisonComplete: true,
        defaultBranch: 'main',
        totalCommits: 1,
        listedCommits: 1,
        omittedCommits: 0,
        summary: { covered: 0, notCovered: 1, unknown: 0 },
        commits: [
          {
            sha: '2'.repeat(40),
            message: 'Add delivery evidence',
            authorUsername: 'glad-fjord',
            authorLogin: 'glad-fjord',
            htmlUrl: `https://github.com/navikt/glad-fjord/commit/${'2'.repeat(40)}`,
            pullRequestNumber: null,
            status: 'not_covered',
            reason: 'no_associated_pull_request',
          },
        ],
      },
    },
    manualApprovalHistory: [
      {
        id: 1,
        reviewer: 'Z990003',
        registeredBy: 'Z990003',
        reviewedAt: '2026-10-19T07:00:00Z',
        registeredAt: '2026-10-19T07:10:00Z',
        baseSha: '1'.repeat(40),
        headSha: '2'.repeat(40),
        commits: [{ sha: '2'.repeat(40), authorLogin: 'glad-fjord', authorNavIdent: 'Z990001', status: 'eligible' }],
        events: [{ type: 'created', actor: 'Z990003', reason: null, at: '2026-10-19T07:10:00Z' }],
      },
    ],
  },
}

export const MissingStoredEvidence: Story = {
  args: {
    repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
    approvalAssessment: {
      status: 'incomplete',
      totalCommits: null,
      listedCommits: 0,
      omittedCommits: 0,
      commits: [],
    },
    userMappings: {},
    delivery: {
      id: 4,
      base_sha: '3'.repeat(40),
      head_sha: '4'.repeat(40),
      created_at: new Date('2026-10-04T10:00:00.000Z'),
      assessment_sync: {
        status: 'retry_wait',
        attempt_count: 2,
        next_attempt_at: '2026-10-04T12:00:00.000Z',
        locked_until: null,
        completed_at: null,
        completed_assessment_version: 0,
        last_error: 'GitHub svarte med en midlertidig feil.',
        updated_at: '2026-10-04T11:55:00.000Z',
        completed_association_snapshots: 1,
        completed_pull_request_snapshots: 0,
        stack_parent_pull_requests: 0,
      },
      page: 1,
      totalPages: 1,
      totalEvidenceEntries: 1,
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
      deployments: [
        {
          id: 18,
          deployed_at: new Date('2026-10-04T12:00:00.000Z'),
          team_slug: 'team-fjord',
          environment_name: 'prod-gcp',
          app_name: 'glad-fjord-api',
          verification_runs: [],
        },
      ],
    },
  },
}
