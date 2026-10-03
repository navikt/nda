import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getMonorepoComparisonBase, getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
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

describe('getPreviousDeploymentForDiff', () => {
  const owner = 'navikt'
  const repo = 'pensjon-selvbetjening-soknad-alder-frontend'

  it('finds previous deployment regardless of audit_start_year (ancestry lookup is unaffected by audit scope)', async () => {
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
    await seedRepository(pool, { githubRepoId: '9001', githubOwner: owner, githubRepoName: repo, auditStartYear: 2026 })
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
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9001',
    })
    await seedRepository(pool, { githubRepoId: '9001', githubOwner: owner, githubRepoName: repo, auditStartYear: 2026 })
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

  it('uses the last diffable deployment before unauthorized deployments', async () => {
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
      commitSha: 'approved-base',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: owner,
      githubRepo: repo,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'unauthorized-repo',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      fourEyesStatus: 'unauthorized_repository',
      githubOwner: owner,
      githubRepo: repo,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'unauthorized-branch',
      createdAt: new Date('2026-01-03T10:00:00Z'),
      fourEyesStatus: 'unauthorized_branch',
      githubOwner: owner,
      githubRepo: repo,
    })
    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'current-head',
      createdAt: new Date('2026-01-04T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const previous = await getMonorepoComparisonBase(currentId, '9001', 'current-head')
    expect(previous?.commit_sha).toBe('approved-base')
    expect(previous?.created_at).toEqual(new Date('2026-01-01T10:00:00Z'))
  })

  it('uses deployment ID to order repository predecessors with the same timestamp', async () => {
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
    const sameTimestamp = new Date('2026-01-15T13:57:00Z')
    const previousId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'previous-sha',
      createdAt: sameTimestamp,
      githubOwner: owner,
      githubRepo: repo,
    })
    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      createdAt: sameTimestamp,
      githubOwner: owner,
      githubRepo: repo,
    })

    const previous = await getMonorepoComparisonBase(currentId, '9001', 'current-sha')
    expect(previous?.commit_sha).toBe('previous-sha')
    expect(previous?.created_at).toEqual(sameTimestamp)
    expect(previousId).toBeLessThan(currentId)
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
    await seedRepository(pool, { githubRepoId: '9001', githubOwner: owner, githubRepoName: repo, auditStartYear: 2020 })
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

describe('getMonorepoComparisonBase', () => {
  it('detects a same-app redeploy even without an earlier distinct repository commit', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9010',
    })
    const first = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'shared-head',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const redeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'shared-head',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    await expect(getMonorepoComparisonBase(first, '9010', 'shared-head')).resolves.toBeNull()
    await expect(getMonorepoComparisonBase(redeploy, '9010', 'shared-head')).resolves.toEqual({
      commit_sha: null,
      created_at: null,
      is_same_app_redeploy: true,
    })
  })

  it('uses the latest distinct valid commit across apps and skips same-head and unauthorized deployments', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-b', environment: 'prod-fss' })
    for (const monitoredAppId of [app1, app2]) {
      await seedApplicationRepository(pool, {
        monitoredAppId,
        githubOwner: 'navikt',
        githubRepo: 'monorepo',
        githubRepoId: '9010',
      })
    }

    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'base-commit',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const firstHead = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'shared-head',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const siblingHead = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha: 'shared-head',
      createdAt: new Date('2026-01-03T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha: 'intervening-commit',
      createdAt: new Date('2026-01-04T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'unauthorized-commit',
      createdAt: new Date('2026-01-05T10:00:00Z'),
      fourEyesStatus: 'unauthorized_branch',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const laterHead = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'shared-head',
      createdAt: new Date('2026-01-06T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    await expect(getMonorepoComparisonBase(firstHead, '9010', 'shared-head')).resolves.toMatchObject({
      commit_sha: 'base-commit',
      is_same_app_redeploy: false,
    })
    await expect(getMonorepoComparisonBase(siblingHead, '9010', 'shared-head')).resolves.toMatchObject({
      commit_sha: 'base-commit',
      is_same_app_redeploy: false,
    })
    await expect(getMonorepoComparisonBase(laterHead, '9010', 'shared-head')).resolves.toMatchObject({
      commit_sha: 'intervening-commit',
      is_same_app_redeploy: true,
    })

    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'different-app-commit',
      createdAt: new Date('2026-01-07T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const rollback = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'shared-head',
      createdAt: new Date('2026-01-08T10:00:00Z'),
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    await expect(getMonorepoComparisonBase(rollback, '9010', 'shared-head')).resolves.toMatchObject({
      commit_sha: 'different-app-commit',
      is_same_app_redeploy: false,
    })
  })
})
