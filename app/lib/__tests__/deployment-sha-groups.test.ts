import { expect, it } from 'vitest'
import { getDeploymentStatusSummary, groupDeploymentsBySha } from '~/lib/deployment-sha-groups'
import { APPROVED_STATUSES, NOT_APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'

it('groups full SHAs in input order without combining missing SHAs or shared prefixes', () => {
  const deployments = [
    { id: 1, commit_sha: 'abcdef01' },
    { id: 2, commit_sha: 'abcdef02' },
    { id: 3, commit_sha: 'abcdef01' },
    { id: 4, commit_sha: null },
    { id: 5, commit_sha: '' },
  ]
  expect(groupDeploymentsBySha(deployments).map((group) => [group.sha, group.deployments.map((d) => d.id)])).toEqual([
    ['abcdef01', [1, 3]],
    ['abcdef02', [2]],
    [null, [4]],
    [null, [5]],
  ])
  expect(groupDeploymentsBySha([])).toEqual([])
})

it('summarizes every existing status using shared categories without approving the SHA', () => {
  const statuses = [...APPROVED_STATUSES, ...NOT_APPROVED_STATUSES, ...PENDING_STATUSES]
  expect(getDeploymentStatusSummary(statuses.map((four_eyes_status) => ({ four_eyes_status })))).toBe(
    `${APPROVED_STATUSES.length} godkjente, ${NOT_APPROVED_STATUSES.length} ikke godkjente, ${PENDING_STATUSES.length} venter`,
  )
})

it('counts only supplied deployments and keeps unrecognized statuses explicit', () => {
  expect(
    getDeploymentStatusSummary([
      { four_eyes_status: 'approved' },
      { four_eyes_status: 'direct_push' },
      { four_eyes_status: 'unknown' },
      { four_eyes_status: 'future_status' },
    ]),
  ).toBe('1 godkjent, 1 ikke godkjent, 1 venter, 1 med ukjent status')
  expect(getDeploymentStatusSummary([{ four_eyes_status: 'direct_push' }])).toBe('1 ikke godkjent')
  expect(getDeploymentStatusSummary([])).toBe('')
})
