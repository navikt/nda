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
        implicitApprovalMode: 'dependabot_only',
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
            deployment_source: 'nais_deployment',
            deployment_source_id: 'deploy-10',
            deployed_at: new Date('2026-10-14T10:00:00.000Z'),
            team_slug: 'team-fjord',
            app_name: 'glad-fjord',
            environment_name: 'prod-gcp',
            deployed_sha: 'a'.repeat(40),
            branch_name: 'main',
            trigger_url: null,
            github_pr_number: null,
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
        deliveries: [
          {
            id: 9,
            base_sha: 'b'.repeat(40),
            head_sha: 'b'.repeat(40),
            registered_at: new Date('2026-10-14T09:00:00.000Z'),
            first_deployed_at: null,
            deployment_count: 0,
            contexts: [{ unresolvedDeploymentId: 10, relativePosition: 'before' }],
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
        verificationRuns: [
          {
            id: 1,
            deployment_id: 10,
            run_at: new Date('2026-10-14T10:07:00.000Z'),
            schema_version: 3,
            pr_snapshot_ids: [11],
            commit_snapshot_ids: [12, 13],
            result: { status: 'unverified_commits', unverifiedCommits: [] },
            status: 'unverified_commits',
          },
        ],
        repositoryConfigAuditLog: [
          {
            id: 4,
            setting_key: 'implicit_approval_mode',
            old_value: { implicit_approval_mode: 'off' },
            new_value: { implicit_approval_mode: 'dependabot_only' },
            changed_by_nav_ident: 'Z990010',
            changed_by_name: 'Rask Elv',
            change_reason: 'Test',
            created_at: new Date('2026-10-14T09:00:00.000Z'),
          },
        ],
        diagnosticTargets: [
          {
            unresolvedDeploymentId: 10,
            unresolvedDeployedAt: new Date('2026-10-14T10:00:00.000Z'),
            nearbyDeliveryCountPerSide: 2,
            includedDeliveryIds: [9],
            includedDeploymentIds: [10],
          },
        ],
        prSnapshots: [
          {
            id: 11,
            owner: 'navikt',
            repo: 'glad-fjord',
            pr_number: 100,
            schema_version: 1,
            fetched_at: new Date('2026-10-14T10:01:00.000Z'),
            data_type: 'reviews',
            source: 'github',
            github_available: true,
            data: { reviews: [] },
          },
        ],
        commitSnapshots: [
          {
            id: 12,
            owner: 'navikt',
            repo: 'glad-fjord',
            sha: 'c'.repeat(40),
            schema_version: 1,
            fetched_at: new Date('2026-10-14T10:02:00.000Z'),
            data_type: 'prs',
            source: 'github',
            github_available: true,
            data: { pull_requests: [] },
          },
        ],
        workflowRunSnapshots: [
          {
            id: 13,
            run_id: '12345',
            github_repo_id: '12345',
            owner: 'navikt',
            repo: 'glad-fjord',
            api_version: '2022-11-28',
            api_deprecated_at: null,
            api_sunset_at: null,
            fetched_at: new Date('2026-10-14T10:03:00.000Z'),
            data: { event: 'push' },
          },
        ],
        liveGitHubEvidence: {
          fetchedAt: '2026-10-14T10:59:00.000Z',
          status: 'complete',
          requestLimit: 100,
          requestsAttempted: 0,
          pullRequests: [],
          workflowRuns: [],
        },
      },
      new Date('2026-10-14T11:00:00.000Z'),
    )
    const parsed = JSON.parse(json)

    expect(parsed.schemaVersion).toBe(4)
    expect(parsed.exportedAt).toBe('2026-10-14T11:00:00.000Z')
    expect(parsed.repository.githubRepositoryId).toBe('12345')
    expect(parsed.implicitApprovalMode).toBe('dependabot_only')
    expect(parsed.deployments[0].deployed_at).toBe('2026-10-14T10:00:00.000Z')
    expect(parsed.deliveries[0].first_deployed_at).toBeNull()
    expect(parsed.deliveries[0].deployment_count).toBe(0)
    expect(parsed.ancestryEvidence.matchingCompareSnapshots[0].compare_status).toBe('behind')
    expect(parsed.ancestryEvidence.matchingCompareSnapshots[0].compare_commit_shas).toEqual([
      'c'.repeat(40),
      'd'.repeat(40),
    ])
    expect(parsed.verificationRuns[0]).toMatchObject({
      id: 1,
      deployment_id: 10,
      status: 'unverified_commits',
      pr_snapshot_ids: [11],
      commit_snapshot_ids: [12, 13],
    })
    expect(parsed.verificationRuns[0].run_at).toBe('2026-10-14T10:07:00.000Z')
    expect(parsed.repositoryConfigAuditLog[0]).toMatchObject({
      setting_key: 'implicit_approval_mode',
      old_value: { implicit_approval_mode: 'off' },
      new_value: { implicit_approval_mode: 'dependabot_only' },
      changed_by_nav_ident: 'Z990010',
    })
    expect(parsed.repositoryConfigAuditLog[0].created_at).toBe('2026-10-14T09:00:00.000Z')
    expect(parsed.diagnosticTargets).toMatchObject([
      {
        unresolvedDeploymentId: 10,
        nearbyDeliveryCountPerSide: 2,
        includedDeliveryIds: [9],
        includedDeploymentIds: [10],
      },
    ])
    expect(parsed.diagnosticTargets[0].unresolvedDeployedAt).toBe('2026-10-14T10:00:00.000Z')
    expect(parsed.prSnapshots[0].data).toEqual({ reviews: [] })
    expect(parsed.commitSnapshots[0].sha).toBe('c'.repeat(40))
    expect(parsed.workflowRunSnapshots[0].data).toEqual({ event: 'push' })
    expect(parsed.interpretationNotes).toContain(
      'A matching GitHub compare snapshot is candidate evidence only. NDA does not directly link that snapshot to a specific unresolved retry.',
    )
    expect(parsed.interpretationNotes).toContain(
      'Repository configuration audit entries include recorded changes only. An absent entry does not establish the setting value at a historical time, especially before repository-level audit logging or for settings initialized during repository backfill.',
    )
    expect(parsed.liveGitHubEvidence.status).toBe('complete')
    expect(parsed.interpretationNotes).toContain(
      'liveGitHubEvidence is fetched from GitHub when the export is generated and includes current PR metadata, review records, and workflow job/step outcomes for PRs and workflow runs referenced by the bounded diagnostic. It is not the verification decision stored at deployment time. Each item records its fetch status; missing or failed live evidence must not be interpreted as an empty review or job history.',
    )
    expect(parsed.interpretationNotes).toContain(
      'implicitApprovalMode is read within the same repeatable-read database snapshot as the audit entries and exported evidence.',
    )
    expect(parsed.interpretationNotes).toContain(
      'implicitApprovalMode is the current value. Historical values can only be reconstructed where the audit log provides sufficient changes from a known starting value.',
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
        implicitApprovalMode: 'off',
        historyReadiness: {
          applications: [],
          repositoryDeploymentCount: 0,
          repositoryDeploymentsMissingShaCount: 0,
          repositoryDeploymentsWithoutKnownAppLinkCount: 0,
        },
        deployments: [],
        deliveries: [],
        ancestryEvidence: { matchingCompareSnapshots: [], linkageNote: 'No matching evidence.' },
        verificationRuns: [],
        repositoryConfigAuditLog: [],
        diagnosticTargets: [],
        prSnapshots: [],
        commitSnapshots: [],
        workflowRunSnapshots: [],
        liveGitHubEvidence: {
          fetchedAt: '2026-10-14T10:59:00.000Z',
          status: 'not_needed',
          requestLimit: 100,
          requestsAttempted: 0,
          pullRequests: [],
          workflowRuns: [],
        },
      }),
    )

    expect(parsed.deployments).toEqual([])
    expect(parsed.deliveries).toEqual([])
    expect(parsed.ancestryEvidence.matchingCompareSnapshots).toEqual([])
    expect(parsed.verificationRuns).toEqual([])
    expect(parsed.repositoryConfigAuditLog).toEqual([])
    expect(parsed.prSnapshots).toEqual([])
    expect(parsed.commitSnapshots).toEqual([])
    expect(parsed.workflowRunSnapshots).toEqual([])
  })
})
