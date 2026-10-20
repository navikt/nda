import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildReportData, getAuditReportData } from '../../audit-reports.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

const PERIOD_START = new Date('2026-01-01T00:00:00Z')
const PERIOD_END = new Date('2026-12-31T23:59:59Z')
const IN_PERIOD = new Date('2026-03-10T10:00:00Z')

describe('baseline deployment in audit report', () => {
  it('maps a baseline deployment to method="baseline" with approver from status history', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
      title: 'Baseline deployment',
      githubPrData: {
        reviewers: [{ username: 'some-reviewer', state: 'APPROVED', submitted_at: '2026-03-10T09:00:00Z' }],
      },
    })

    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, created_at)
       VALUES ($1, 'pending_baseline', 'baseline', 'Z990001', 'baseline_approval', $2)`,
      [deploymentId, IN_PERIOD],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.baseline_count).toBe(1)
    expect(report.deployments).toHaveLength(1)

    const entry = report.deployments[0]
    expect(entry.method).toBe('baseline')
    expect(entry.approver).toBe('Z990001')
  })

  it('throws when baseline deployment has no status history row', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-gcp' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
      githubPrData: {
        reviewers: [{ username: 'some-reviewer', state: 'APPROVED', submitted_at: '2026-03-10T09:00:00Z' }],
      },
    })

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)

    expect(() => buildReportData(rawData)).toThrow(/missing an approver/)
  })

  it('counts baseline_count correctly alongside pr deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-d', appName: 'app-d', environment: 'prod-gcp' })

    const baselineId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, created_at)
       VALUES ($1, 'pending_baseline', 'baseline', 'Z990002', 'baseline_approval', $2)`,
      [baselineId, new Date('2026-02-01T11:00:00Z')],
    )

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2026-04-01T10:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-04-01T09:00:00Z' }],
      },
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2026-06-01T10:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer2', state: 'APPROVED', submitted_at: '2026-06-01T09:00:00Z' }],
      },
    })

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.deployments).toHaveLength(3)
    expect(report.baseline_count).toBe(1)
    expect(report.deployments.filter((d) => d.method === 'pr')).toHaveLength(2)
  })
})

describe('repository resolution for zero-deployment audit report', () => {
  it('resolves the newest active repository link when the period has no deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-e', appName: 'app-e', environment: 'prod-gcp' })

    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'old-repo',
      githubRepoId: '1001',
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'new-repo',
      githubRepoId: '1002',
      status: 'active',
    })

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)

    expect(rawData.deployments).toHaveLength(0)
    expect(rawData.repository).toBe('navikt/new-repo')
  })

  it('falls back to "unknown" when the app has no active repository link and no deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-f', appName: 'app-f', environment: 'prod-gcp' })

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)

    expect(rawData.deployments).toHaveLength(0)
    expect(rawData.repository).toBe('unknown')
  })
})

describe('renamed Apply deployments in audit reports', () => {
  it('uses the persisted verified commit list when only a transformed comparison cache exists', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-g', appName: 'app-g', environment: 'prod-gcp' })
    await pool.query('UPDATE monitored_applications SET nais_apply_enabled = true WHERE id = $1', [appId])
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '7001',
      githubOwner: 'navikt',
      githubRepoName: 'current-repo',
    })
    const baseSha = 'a'.repeat(40)
    const headSha = 'b'.repeat(40)
    const comparedCommitShas = ['c'.repeat(40), 'd'.repeat(40)]

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-g',
      environment: 'prod-gcp',
      createdAt: new Date('2026-03-09T10:00:00Z'),
      commitSha: baseSha,
      fourEyesStatus: 'approved_pr',
    })
    const applyDeploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-g',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      commitSha: headSha,
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'current-repo',
    })
    await pool.query(
      `UPDATE deployments
       SET deployment_source = 'nais_apply',
           nais_deployment_id = NULL,
           deployment_source_id = '7001:12345',
           repository_id = $2
       WHERE id = $1`,
      [applyDeploymentId, repositoryId],
    )
    await pool.query(
      `INSERT INTO github_compare_snapshots (owner, repo, base_sha, head_sha, schema_version, data)
       VALUES ('navikt', 'current-repo', $1, $2, 1, $3)`,
      [baseSha, headSha, JSON.stringify({ commits: comparedCommitShas.map((sha) => ({ sha })) })],
    )
    await pool.query(
      `INSERT INTO verification_runs (deployment_id, schema_version, result, status)
       VALUES ($1, 1, $2, 'approved')`,
      [
        applyDeploymentId,
        JSON.stringify({
          comparisonRange: { baseSha, headSha },
          comparisonCommitHeadSha: headSha,
          comparisonCommitShas: comparedCommitShas,
        }),
      ],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)

    expect(rawData.deployments.find(({ id }) => id === applyDeploymentId)?.delivery_commit_shas).toEqual(
      comparedCommitShas,
    )
  })

  it('uses snapshots scoped to the immutable repository ID instead of the claim-time name', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-g', appName: 'app-g', environment: 'prod-gcp' })
    await pool.query('UPDATE monitored_applications SET nais_apply_enabled = true WHERE id = $1', [appId])

    const repositoryId = await seedRepository(pool, {
      githubRepoId: '7001',
      githubOwner: 'navikt',
      githubRepoName: 'current-repo',
    })
    await seedRepository(pool, {
      githubRepoId: '7002',
      githubOwner: 'navikt',
      githubRepoName: 'old-repo',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-g',
      environment: 'prod-gcp',
      createdAt: new Date('2026-03-09T10:00:00Z'),
      commitSha: 'a'.repeat(40),
      fourEyesStatus: 'approved_pr',
    })
    const siblingAppId = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h',
      environment: 'prod-gcp',
    })
    const interleavedDeploymentId = await seedDeployment(pool, {
      monitoredAppId: siblingAppId,
      teamSlug: 'team-h',
      environment: 'prod-gcp',
      createdAt: new Date('2026-03-09T11:00:00Z'),
      commitSha: 'c'.repeat(40),
      fourEyesStatus: 'approved_pr',
    })
    await pool.query(`UPDATE deployments SET repository_id = $2 WHERE id = $1`, [interleavedDeploymentId, repositoryId])
    const applyDeploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-g',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      commitSha: 'b'.repeat(40),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'old-repo',
    })
    await pool.query(
      `UPDATE deployments
       SET deployment_source = 'nais_apply',
           nais_deployment_id = NULL,
           deployment_source_id = '7001:12345',
           repository_id = $2,
           github_pr_number = 42
       WHERE id = $1`,
      [applyDeploymentId, repositoryId],
    )

    await pool.query(
      `INSERT INTO github_compare_snapshots (owner, repo, base_sha, head_sha, schema_version, data)
       VALUES ('navikt', 'old-repo', $1, $2, 1, $3)`,
      ['a'.repeat(40), 'b'.repeat(40), JSON.stringify({ commits: [{ sha: 'c'.repeat(40) }] })],
    )
    await pool.query(
      `INSERT INTO github_compare_raw_snapshots
         (github_repo_id, owner, repo, base_sha, head_sha, api_version, data)
       VALUES
         ('7001', 'navikt', 'current-repo', $1, $3, '2022-11-28', $4),
         ('7001', 'navikt', 'current-repo', $2, $3, '2022-11-28', $5)`,
      [
        'a'.repeat(40),
        'c'.repeat(40),
        'b'.repeat(40),
        JSON.stringify({ commits: [{ sha: 'd'.repeat(40) }] }),
        JSON.stringify({ commits: [{ sha: 'e'.repeat(40) }] }),
      ],
    )
    await pool.query(
      `INSERT INTO verification_runs
         (deployment_id, schema_version, result, status)
       VALUES ($1, 1, $2, 'approved')`,
      [
        applyDeploymentId,
        JSON.stringify({
          comparisonRange: { baseSha: 'c'.repeat(40), headSha: 'b'.repeat(40) },
        }),
      ],
    )
    await pool.query(
      `INSERT INTO github_pr_raw_snapshots
         (github_repo_id, owner, repo, pr_number, data_type, api_version, data)
       VALUES
         ('7001', 'navikt', 'old-repo', 42, 'commits', '2022-11-28', $1),
         ('7002', 'navikt', 'old-repo', 42, 'commits', '2022-11-28', $2)`,
      [JSON.stringify([{ sha: 'e'.repeat(40) }]), JSON.stringify([{ sha: 'f'.repeat(40) }])],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)

    expect(rawData.deployments.find(({ id }) => id === applyDeploymentId)?.delivery_commit_shas).toEqual([
      'e'.repeat(40),
    ])
    expect(rawData.deployments.find(({ id }) => id === applyDeploymentId)?.pr_commit_shas).toEqual(['e'.repeat(40)])
  })
})
