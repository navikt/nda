import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryManualApprovalHistory } from '~/components/RepositoryManualApprovalHistory'

const meta = {
  title: 'Features/RepositoryAdmin/RepositoryManualApprovalHistory',
  component: RepositoryManualApprovalHistory,
  args: { repository: { githubOwner: 'navikt', githubRepoName: 'glad-fjord' } },
} satisfies Meta<typeof RepositoryManualApprovalHistory>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { entries: [] } }

export const PartialAndRevoked: Story = {
  args: {
    entries: [
      {
        id: 1,
        reviewer: 'Z990003',
        registeredBy: 'Z990003',
        reviewedAt: '2026-10-19T07:00:00Z',
        registeredAt: '2026-10-19T07:10:00Z',
        baseSha: 'a'.repeat(40),
        headSha: 'c'.repeat(40),
        commits: [
          { sha: 'b'.repeat(40), authorLogin: 'glad-fjord', authorNavIdent: 'Z990001', status: 'eligible' },
          {
            sha: 'c'.repeat(40),
            authorLogin: 'rask-elv',
            authorNavIdent: 'Z990002',
            status: 'identity_or_interval_changed',
          },
        ],
        events: [{ type: 'created', actor: 'Z990003', reason: null, at: '2026-10-19T07:10:00Z' }],
      },
      {
        id: 2,
        reviewer: 'Z990002',
        registeredBy: 'Z990002',
        reviewedAt: '2026-10-19T07:00:00Z',
        registeredAt: '2026-10-19T07:10:00Z',
        baseSha: 'a'.repeat(40),
        headSha: 'c'.repeat(40),
        commits: [{ sha: 'b'.repeat(40), authorLogin: 'glad-fjord', authorNavIdent: 'Z990001', status: 'revoked' }],
        events: [
          { type: 'created', actor: 'Z990002', reason: null, at: '2026-10-19T07:10:00Z' },
          { type: 'revoked', actor: 'Z990003', reason: 'Feil grunnlag', at: '2026-10-19T07:20:00Z' },
        ],
      },
    ],
  },
}

export const CanRevoke: Story = {
  args: {
    entries: PartialAndRevoked.args?.entries ?? [],
    canRevoke: true,
    firstDeployedAt: '2026-10-18T08:00:00Z',
  },
}
