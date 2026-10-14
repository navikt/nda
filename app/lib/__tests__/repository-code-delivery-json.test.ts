import { describe, expect, it } from 'vitest'
import { createRepositoryCodeDeliveryJson } from '../repository-code-delivery-json'

describe('createRepositoryCodeDeliveryJson', () => {
  it('exports repository context, deployments, compare evidence, and caveats as valid JSON', () => {
    const json = createRepositoryCodeDeliveryJson(
      {
        repository: {
          id: 5,
          githubRepositoryId: '12345',
          owner: 'navikt',
          name: 'glad-fjord',
          defaultBranch: 'main',
          trackingSince: new Date('2026-10-01T00:00:00.000Z'),
          auditStartYear: 2026,
        },
        historyReadiness: {
          applications: [],
          repositoryDeploymentCount: 1,
          repositoryDeploymentsMissingShaCount: 0,
          repositoryDeploymentsWithoutKnownAppLinkCount: 0,
        },
        deployments: [
          {
            deployment_id: 10,
            nais_deployment_id: 'deploy-10',
            deployed_at: new Date('2026-10-14T10:00:00.000Z'),
            team_slug: 'team-fjord',
            app_name: 'glad-fjord',
            environment_name: 'prod-gcp',
            deployed_sha: 'a'.repeat(40),
            branch_name: 'main',
            delivery_id: null,
            delivery_base_sha: null,
            delivery_head_sha: null,
            delivery_registered_at: null,
            delivery_first_deployed_at: null,
            unresolved_reason: 'ancestry_behind',
            unresolved_first_seen_at: new Date('2026-10-14T10:05:00.000Z'),
            unresolved_last_attempt_at: new Date('2026-10-14T10:06:00.000Z'),
            unresolved_resolved_at: null,
            tracking_since: new Date('2026-10-01T00:00:00.000Z'),
            default_branch: 'main',
          },
        ],
        ancestryEvidence: {
          matchingCompareSnapshots: [
            {
              unresolved_deployment_id: 10,
              unresolved_deployed_sha: 'a'.repeat(40),
              unresolved_deployed_at: new Date('2026-10-14T10:00:00.000Z'),
              unresolved_reason: 'ancestry_behind',
              unresolved_first_seen_at: new Date('2026-10-14T10:05:00.000Z'),
              unresolved_last_attempt_at: new Date('2026-10-14T10:06:00.000Z'),
              delivery_id: 9,
              delivery_head_sha: 'b'.repeat(40),
              compare_base_sha: 'b'.repeat(40),
              compare_head_sha: 'a'.repeat(40),
              compare_status: 'behind',
              compare_ahead_by: 0,
              compare_behind_by: 2,
              compare_total_commits: 2,
              compare_commit_shas: ['c'.repeat(40), 'd'.repeat(40)],
              compare_fetched_at: new Date('2026-10-14T10:05:00.000Z'),
              compare_api_version: '2022-11-28',
              compare_api_deprecated_at: null,
              compare_api_sunset_at: null,
              fetched_between_observations: true,
            },
          ],
          linkageNote: 'Candidate evidence only.',
        },
      },
      new Date('2026-10-14T11:00:00.000Z'),
    )
    const parsed = JSON.parse(json)

    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe('2026-10-14T11:00:00.000Z')
    expect(parsed.repository.githubRepositoryId).toBe('12345')
    expect(parsed.deployments[0].deployed_at).toBe('2026-10-14T10:00:00.000Z')
    expect(parsed.ancestryEvidence.matchingCompareSnapshots[0].compare_status).toBe('behind')
    expect(parsed.ancestryEvidence.matchingCompareSnapshots[0].compare_commit_shas).toEqual([
      'c'.repeat(40),
      'd'.repeat(40),
    ])
    expect(parsed.interpretationNotes).toContain(
      'A matching GitHub compare snapshot is candidate evidence only. NDA does not directly link that snapshot to a specific unresolved retry.',
    )
  })

  it('exports empty collections when the repository has no matching data', () => {
    const parsed = JSON.parse(
      createRepositoryCodeDeliveryJson({
        repository: {
          id: 5,
          githubRepositoryId: '12345',
          owner: 'navikt',
          name: 'glad-fjord',
          defaultBranch: null,
          trackingSince: null,
          auditStartYear: null,
        },
        historyReadiness: {
          applications: [],
          repositoryDeploymentCount: 0,
          repositoryDeploymentsMissingShaCount: 0,
          repositoryDeploymentsWithoutKnownAppLinkCount: 0,
        },
        deployments: [],
        ancestryEvidence: { matchingCompareSnapshots: [], linkageNote: 'No matching evidence.' },
      }),
    )

    expect(parsed.deployments).toEqual([])
    expect(parsed.ancestryEvidence.matchingCompareSnapshots).toEqual([])
  })
})
