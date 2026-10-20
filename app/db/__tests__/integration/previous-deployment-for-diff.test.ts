import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
import { findRootApprovedSiblingForCommit } from '~/lib/verification/fetch-data/previous-deployment.server'
import {
  seedApp,
  seedApplicationRepository as seedApplicationRepositoryRow,
  seedDeployment,
  seedRepository,
  truncateAllTables,
} from './helpers'

async function seedApplicationRepository(
  pool: Pool,
  options: Parameters<typeof seedApplicationRepositoryRow>[1],
): Promise<number> {
  if (options.githubRepoId) {
    await pool.query(
      `INSERT INTO repositories (github_repo_id, github_owner, github_repo_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (github_repo_id) DO NOTHING`,
      [options.githubRepoId, options.githubOwner, options.githubRepo],
    )
  }
  return seedApplicationRepositoryRow(pool, options)
}

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

describe('getPreviousDeploymentForDiff', () => {
  const owner = 'navikt'
  const repo = 'pensjon-selvbetjening-soknad-alder-frontend'

  it('finds previous deployment regardless of audit_start_year (ancestry lookup is unaffected by audit scope)', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    await seedRepository(pool, { githubRepoId: '9001', githubOwner: owner, githubRepoName: repo, auditStartYear: 2026 })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    const olderId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'old1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2025-12-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    const firstId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'new5678bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      createdAt: new Date('2026-01-15T13:57:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeploymentForDiff(firstId, '9001')
    expect(prev?.id).toBe(olderId)
  })

  it('returns previous deployment within audit window', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    await seedRepository(pool, { githubRepoId: '9001', githubOwner: owner, githubRepoName: repo, auditStartYear: 2026 })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    const firstId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'aaaa1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T13:57:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    const secondId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'bbbb2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeploymentForDiff(secondId, '9001')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(firstId)
  })

  it('finds previous deployment by immutable repository ID when claims use an old name', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '9001',
      githubOwner: owner,
      githubRepoName: 'renamed-repository',
      auditStartYear: 2026,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: 'renamed-repository',
      githubRepoId: '9001',
    })
    const previousId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'old1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2025-12-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'new5678bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      createdAt: new Date('2026-01-15T13:57:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = ANY($2::int[])', [
      repositoryId,
      [previousId, currentId],
    ])

    const previous = await getPreviousDeploymentForDiff(currentId, '9001')

    expect(previous?.id).toBe(previousId)
  })

  it('does not reuse another repository deployment as a diff base or approved root', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'multi-repo-app',
      environment: 'prod-gcp',
    })
    const repositoryAId = await seedRepository(pool, {
      githubRepoId: '9001',
      githubOwner: owner,
      githubRepoName: repo,
    })
    const repositoryBId = await seedRepository(pool, {
      githubRepoId: '9002',
      githubOwner: owner,
      githubRepoName: 'other-repo',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: 'other-repo',
      githubRepoId: '9002',
      status: 'historical',
    })
    const otherRepositoryDeploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'same-repository-commit',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: owner,
      githubRepo: repo,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [
      repositoryBId,
      otherRepositoryDeploymentId,
    ])
    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'current-repository-commit',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryAId, currentId])

    expect(await getPreviousDeploymentForDiff(currentId, '9001')).toBeNull()
    expect(await findRootApprovedSiblingForCommit('same-repository-commit', '9001', currentId)).toBeNull()
  })

  it('does not select a later approved delivery as the root for a backfilled Apply delivery', async () => {
    const approvedAppId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'approved-app',
      environment: 'prod-gcp',
    })
    const applyAppId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'apply-app',
      environment: 'prod-gcp',
    })
    await pool.query('UPDATE monitored_applications SET nais_apply_enabled = true WHERE id = $1', [applyAppId])
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '9001',
      githubOwner: owner,
      githubRepoName: repo,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: approvedAppId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: applyAppId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    const commitSha = 'e'.repeat(40)
    const laterApprovedId = await seedDeployment(pool, {
      monitoredAppId: approvedAppId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha,
      createdAt: new Date('2026-01-20T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: owner,
      githubRepo: repo,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, laterApprovedId])
    const backfilledApplyId = await seedDeployment(pool, {
      monitoredAppId: applyAppId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha,
      createdAt: new Date('2026-01-10T10:00:00Z'),
      fourEyesStatus: 'pending',
      githubOwner: owner,
      githubRepo: repo,
    })
    await pool.query(
      `UPDATE deployments
       SET deployment_source = 'nais_apply',
           nais_deployment_id = NULL,
           deployment_source_id = '9001:12345',
           repository_id = $2
       WHERE id = $1`,
      [backfilledApplyId, repositoryId],
    )

    expect(await findRootApprovedSiblingForCommit(commitSha, '9001', backfilledApplyId)).toBeNull()
  })

  it('skips legacy and legacy_pending deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'leg11111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'legacy',
      githubOwner: owner,
      githubRepo: repo,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'leg22222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      fourEyesStatus: 'legacy_pending',
      githubOwner: owner,
      githubRepo: repo,
    })
    const newId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'newaaaa1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeploymentForDiff(newId, '9001')
    expect(prev).toBeNull()
  })

  it('skips unauthorized_repository and unauthorized_branch deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'unarepo1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'unauthorized_repository',
      githubOwner: owner,
      githubRepo: repo,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'unabranc1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      fourEyesStatus: 'unauthorized_branch',
      githubOwner: owner,
      githubRepo: repo,
    })
    const unauthorizedNewId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'newaaaa2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const unauthorizedPrev = await getPreviousDeploymentForDiff(unauthorizedNewId, '9001')
    expect(unauthorizedPrev).toBeNull()
  })

  it('skips deployments with refs/* commit_sha', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'refs/heads/main',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    const newId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'realsha1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeploymentForDiff(newId, '9001')
    expect(prev).toBeNull()
  })

  it('finds previous deployment across environments within same repo (no environment filter)', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    const devId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'dev-gcp',
      commitSha: 'devsha11aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    const prodId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'prodsha1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeploymentForDiff(prodId, '9001')
    expect(prev?.id).toBe(devId)
  })

  it('uses the shared repository audit_start_year for both acting and sibling apps', async () => {
    const actingAppId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'acting-app',
      environment: 'prod-gcp',
    })
    const siblingAppId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'sibling-app',
      environment: 'prod-gcp',
    })
    await seedRepository(pool, { githubRepoId: '9001', githubOwner: owner, githubRepoName: repo, auditStartYear: 2020 })
    await seedApplicationRepository(pool, {
      monitoredAppId: actingAppId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: siblingAppId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    const siblingDeploymentId = await seedDeployment(pool, {
      monitoredAppId: siblingAppId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'sibsha11aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: owner,
      githubRepo: repo,
    })
    const actingDeploymentId = await seedDeployment(pool, {
      monitoredAppId: actingAppId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'actsha11aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeploymentForDiff(actingDeploymentId, '9001')
    expect(prev?.id).toBe(siblingDeploymentId)
    expect(prev?.monitored_app_id).toBe(siblingAppId)
    expect(prev?.four_eyes_status).toBe('approved')
  })
})
