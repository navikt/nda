import { VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { approvalRepository, approvalReview } from '~/components/__fixtures__/repository-approval'
import { RepositoryApprovalDeliveriesPage } from '~/components/RepositoryApprovalDeliveriesPage'
import {
  RepositoryApprovalConfirmation,
  RepositoryApprovalSnapshot,
  RepositoryManualApprovalPage,
} from '~/components/RepositoryManualApprovalPage'

const meta = {
  title: 'Features/Repository/ManualApproval',
  component: RepositoryManualApprovalPage,
  args: {
    repository: approvalRepository,
    delivery: {
      id: 17,
      base_sha: approvalReview.baseSha,
      head_sha: approvalReview.headSha,
      first_deployed_at: '2026-10-18T08:00:00Z',
    },
    manualApprovalHistory: [],
  },
} satisfies Meta<typeof RepositoryManualApprovalPage>
export default meta
type Story = StoryObj<typeof meta>

export const BeforeReview: Story = {}

export const FrozenGroundAndExplicitSelection: Story = {
  render: () => (
    <VStack gap="space-24">
      <RepositoryApprovalSnapshot repository={approvalRepository} review={approvalReview} />
      <RepositoryApprovalConfirmation review={approvalReview} />
    </VStack>
  ),
}

export const MissingTimeGround: Story = {
  render: () => {
    const review = { ...approvalReview, commits: [approvalReview.commits[4]] }
    return (
      <VStack gap="space-24">
        <RepositoryApprovalSnapshot repository={approvalRepository} review={review} />
        <RepositoryApprovalConfirmation review={review} />
      </VStack>
    )
  },
}

export const WithStoredPullRequest: Story = {
  render: () => {
    const review = {
      ...approvalReview,
      commits: [
        {
          ...approvalReview.commits[0],
          prStatus: 'covered' as const,
          prReason: 'approved_review' as const,
          pullRequestNumber: 42,
          associations: { complete: true, pullRequests: [{ number: 42, baseBranch: 'main' }] },
        },
      ],
      pullRequests: [
        {
          number: 42,
          headSha: approvalReview.commits[0].sha,
          baseBranch: 'main',
          authorLogin: 'glad-fjord',
          mergedByLogin: 'rask-elv',
          mergeCommitSha: approvalReview.headSha,
          commitCount: 1,
          commits: [
            {
              sha: approvalReview.commits[0].sha,
              authorLogin: 'glad-fjord',
              authorDate: '2026-10-17T09:00:00Z',
              committerDate: '2026-10-17T10:00:00Z',
            },
          ],
          reviews: [
            {
              username: 'rask-elv',
              state: 'APPROVED',
              submittedAt: '2026-10-17T11:00:00Z',
              commitSha: approvalReview.commits[0].sha,
            },
          ],
        },
      ],
    }
    return <RepositoryApprovalSnapshot repository={approvalRepository} review={review} />
  },
}

export const SubsequentApproval: Story = {
  args: {
    manualApprovalHistory: [
      {
        id: 41,
        reviewer: 'Z990003',
        registeredBy: 'Z990003',
        reviewedAt: '2026-10-19T08:00:00Z',
        registeredAt: '2026-10-19T09:00:00Z',
        baseSha: approvalReview.baseSha,
        headSha: approvalReview.headSha,
        reviewDocumentation: 'Gjennomgått kodeendringene og testene for første commit.',
        documentationUrl: 'https://example.com/review',
        commits: [
          {
            sha: approvalReview.commits[0].sha,
            authorLogin: 'glad-fjord',
            authorNavIdent: 'Z990001',
            status: 'eligible',
          },
        ],
        events: [{ type: 'created', actor: 'Z990003', reason: null, at: '2026-10-19T09:00:00Z' }],
      },
    ],
  },
}

export const DeliveryListForApprover: Story = {
  render: () => (
    <RepositoryApprovalDeliveriesPage
      repository={approvalRepository}
      deliveries={[
        {
          id: 17,
          baseSha: approvalReview.baseSha,
          headSha: approvalReview.headSha,
          firstDeployedAt: '2026-10-18T08:00:00Z',
        },
      ]}
      page={1}
      hasNextPage={false}
    />
  ),
}
