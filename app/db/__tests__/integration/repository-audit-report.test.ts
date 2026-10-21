import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { assessRepositoryDeliveryInterval } from '~/lib/repository-code-delivery/interval-assessment'
import { getRepositoryAuditReportData } from '../../audit-reports/repository-data.server'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '../../repository-code-deliveries.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

let pool: Pool
const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const start = new Date('2026-01-01T00:00:00Z')
const end = new Date('2026-01-31T23:59:59.999Z')

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})
afterEach(async () => {
  await truncateAllTables(pool)
})

describe('repository audit report selection and evidence', () => {
  it('preserves exact app/period selection and never substitutes an unlinked same-SHA delivery', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'test', environment: 'prod-gcp' })
    const otherApp = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'other', environment: 'prod-gcp' })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '123',
      githubOwner: 'navikt',
      githubRepoName: 'historical',
      defaultBranch: 'main',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'current',
      githubRepoId: '456',
    })
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })
    const createDeployment = (monitoredAppId: number, createdAt: Date) =>
      seedDeployment(pool, {
        monitoredAppId,
        teamSlug: 'team-fjord',
        environment: 'prod-gcp',
        commitSha: headSha,
        createdAt,
        fourEyesStatus: 'approved',
        workflowTriggerConfig: { triggerEvent: 'push' },
      })
    const first = await createDeployment(appId, start)
    const sameTime = await createDeployment(appId, start)
    const last = await createDeployment(appId, end)
    const excluded = await createDeployment(otherApp, start)
    await createDeployment(appId, new Date(start.getTime() - 1))
    await createDeployment(appId, new Date(end.getTime() + 1))
    await pool.query('UPDATE deployments SET repository_id = $1, branch_name = $2 WHERE id = ANY($3::int[])', [
      repositoryId,
      'main',
      [first, sameTime, last, excluded],
    ])
    await linkDeploymentToRepositoryCodeDelivery(first, delivery.id)
    await linkDeploymentToRepositoryCodeDelivery(sameTime, delivery.id)

    const result = await getRepositoryAuditReportData(appId, start, end)
    expect(result.reportData.deployments.map((deployment) => deployment.id)).toEqual([first, sameTime, last])
    expect(result.reportData.deliveries).toHaveLength(1)
    expect(result.reportData.deliveries[0]).toMatchObject({
      repositoryId,
      githubRepoId: '123',
      githubRepoName: 'historical',
      assessment: { status: 'incomplete' },
    })
    expect(result.readiness.deployments).toEqual([
      { deploymentId: first, blockers: ['incomplete_coverage'] },
      { deploymentId: sameTime, blockers: ['incomplete_coverage'] },
      { deploymentId: last, blockers: ['missing_link'] },
    ])
    const { rows } = await pool.query('SELECT repository_code_delivery_id FROM deployments WHERE id = $1', [last])
    expect(rows[0].repository_code_delivery_id).toBeNull()
    const { rows: reports } = await pool.query('SELECT count(*)::int AS count FROM audit_reports')
    expect(reports[0].count).toBe(0)
  })

  it('freezes replayable evidence and exact raw snapshot references without mixing repository identities', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'test', environment: 'prod-gcp' })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '123',
      githubOwner: 'navikt',
      githubRepoName: 'test',
      defaultBranch: 'main',
    })
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-fjord',
      environment: 'prod-gcp',
      commitSha: headSha,
      createdAt: start,
      workflowTriggerConfig: { triggerEvent: 'push' },
      fourEyesStatus: 'pending',
    })
    await pool.query('UPDATE deployments SET repository_id = $1, branch_name = $2 WHERE id = $3', [
      repositoryId,
      'main',
      deploymentId,
    ])
    await linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)
    const commit = {
      sha: headSha,
      author: { login: 'glad-fjord' },
      parents: [{ sha: baseSha }],
      commit: { message: 'Ny funksjon', author: { name: 'Glad Fjord', date: '2025-12-30T12:00:00Z' } },
    }
    const { rows: comparisons } = await pool.query<{ id: number }>(
      `INSERT INTO github_compare_raw_snapshots (github_repo_id, owner, repo, base_sha, head_sha, api_version, data)
       VALUES ('123', 'navikt', 'test', $1, $2, '2022-11-28', $3::jsonb) RETURNING id`,
      [
        baseSha,
        headSha,
        JSON.stringify({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, commits: [commit] }),
      ],
    )
    const { rows: associations } = await pool.query<{ id: number }>(
      `INSERT INTO github_commit_associated_prs_raw_snapshots
         (github_repo_id, owner, repo, sha, api_version, data, pagination_complete)
       VALUES ('123', 'navikt', 'test', $1, '2022-11-28', $2::jsonb, true) RETURNING id`,
      [headSha, JSON.stringify([{ number: 42, base: { ref: 'main' } }])],
    )
    const snapshots = [
      {
        type: 'pr',
        data: {
          number: 42,
          base: { ref: 'main', sha: baseSha },
          head: { ref: 'feature', sha: headSha },
          commits: 1,
          user: { login: 'glad-fjord' },
          merged_by: { login: 'rask-elv' },
          merge_commit_sha: headSha,
        },
      },
      { type: 'commits', data: [commit] },
      {
        type: 'reviews',
        data: [
          {
            id: 1,
            user: { login: 'rask-elv' },
            state: 'APPROVED',
            submitted_at: '2026-02-01T12:00:00Z',
            commit_id: headSha,
          },
        ],
      },
    ]
    const prIds: number[] = []
    for (const snapshot of snapshots) {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO github_pr_raw_snapshots (github_repo_id, owner, repo, pr_number, data_type, api_version, data)
         VALUES ('123', 'navikt', 'test', 42, $1, '2022-11-28', $2::jsonb) RETURNING id`,
        [snapshot.type, JSON.stringify(snapshot.data)],
      )
      prIds.push(rows[0].id)
    }
    await pool.query(
      `INSERT INTO github_compare_raw_snapshots (github_repo_id, owner, repo, base_sha, head_sha, api_version, data)
       VALUES ('456', 'navikt', 'test', $1, $2, '2022-11-28', '{}')`,
      [baseSha, headSha],
    )

    const { reportData, readiness } = await getRepositoryAuditReportData(appId, start, end)
    const frozen = reportData.deliveries[0]
    expect(frozen.assessment.status).toBe('approved')
    expect(readiness.isReady).toBe(true)
    expect(assessRepositoryDeliveryInterval(frozen.evidence)).toEqual(frozen.interval)
    expect(frozen.sources.comparisons.map((source) => source.id)).toEqual([comparisons[0].id])
    expect(frozen.sources.associations.map((source) => source.id)).toEqual([associations[0].id])
    expect(frozen.sources.pullRequests.map((source) => source.id).sort()).toEqual(prIds.sort())
    expect(JSON.parse(JSON.stringify(reportData))).toEqual(reportData)

    await pool.query(
      `INSERT INTO github_pr_raw_snapshots (github_repo_id, owner, repo, pr_number, data_type, api_version, data, fetched_at)
       VALUES ('123', 'navikt', 'test', 42, 'reviews', '2022-11-28', '[]', now() + interval '1 second')`,
    )
    const refreshed = await getRepositoryAuditReportData(appId, start, end)
    expect(refreshed.reportData.deliveries[0].assessment.status).not.toBe('approved')
    expect(frozen.assessment.status).toBe('approved')
    expect(assessRepositoryDeliveryInterval(frozen.evidence)).toEqual(frozen.interval)
  })
})
