import type { RepositoryApprovalReview } from '~/lib/repository-manual-approval'

export const approvalRepository = { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' }

const commit: RepositoryApprovalReview['commits'][number] = {
  sha: 'b'.repeat(40),
  message: 'Legg til støtte for leveranser',
  authorLogin: 'glad-fjord',
  authorNavIdent: 'Z990001',
  authorDate: '2026-10-17T09:00:00Z',
  committerDate: '2026-10-17T10:00:00Z',
  prStatus: 'not_covered',
  prReason: 'no_associated_pull_request',
  pullRequestNumber: null,
  associations: { complete: true, pullRequests: [] },
  unavailableReason: null,
}

export const approvalReview: RepositoryApprovalReview = {
  snapshotId: 23,
  baseSha: 'a'.repeat(40),
  headSha: 'f'.repeat(40),
  createdAt: '2026-10-19T09:00:00Z',
  reviewer: 'Z990003',
  defaultBranch: 'main',
  implicitApprovalMode: 'off',
  commits: [
    commit,
    {
      ...commit,
      sha: 'c'.repeat(40),
      authorNavIdent: 'Z990003',
      authorLogin: 'stille-skog',
      unavailableReason: 'Du kan ikke godkjenne dine egne commits.',
    },
    {
      ...commit,
      sha: 'd'.repeat(40),
      prStatus: 'unknown',
      prReason: 'missing_pull_request_snapshot',
      unavailableReason: 'PR-grunnlaget er ukjent.',
    },
    {
      ...commit,
      sha: 'e'.repeat(40),
      authorLogin: 'rask-elv',
      authorNavIdent: null,
      unavailableReason: 'Forfatteren mangler en aktiv kobling til NAV-ident.',
    },
    {
      ...commit,
      sha: 'f'.repeat(40),
      committerDate: '',
      unavailableReason: 'Lagret committer-tid mangler eller er ugyldig. Ingen alternativ tid brukes.',
    },
  ],
  pullRequests: [],
}
