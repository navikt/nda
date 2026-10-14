import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryCodeDeliveryEvidencePage } from '~/components/RepositoryCodeDeliveryEvidencePage'

const meta: Meta<typeof RepositoryCodeDeliveryEvidencePage> = {
  title: 'Features/RepositoryAdmin/RepositoryCodeDeliveryEvidencePage',
  component: RepositoryCodeDeliveryEvidencePage,
}
export default meta
type Story = StoryObj<typeof RepositoryCodeDeliveryEvidencePage>

export const WithStoredReviews: Story = {
  args: {
    repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
    userMappings: { 'rask-elv': { display_name: 'Rask Elv', nav_ident: 'Z990010' } },
    delivery: {
      id: 3,
      base_sha: '1'.repeat(40),
      head_sha: '2'.repeat(40),
      created_at: new Date('2026-10-03T10:00:00.000Z'),
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
}

export const MissingStoredEvidence: Story = {
  args: {
    repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
    userMappings: {},
    delivery: {
      id: 4,
      base_sha: '3'.repeat(40),
      head_sha: '4'.repeat(40),
      created_at: new Date('2026-10-04T10:00:00.000Z'),
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
