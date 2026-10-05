import { expect, it } from 'vitest'
import { groupDeploymentsBySha } from '~/lib/deployment-sha-groups'

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
