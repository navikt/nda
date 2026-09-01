import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
import { seedApp, seedApplicationRepository, seedDeployment, truncateAllTables } from './helpers'

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

  it('respects audit_start_year — first deployment in audit window has no previous', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
      auditStartYear: 2026,
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
    expect(prev).toBeNull()
  })

  it('returns previous deployment within audit window', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
      auditStartYear: 2026,
    })
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

  it('skips legacy and legacy_pending deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
      auditStartYear: null,
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
      auditStartYear: null,
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
      auditStartYear: null,
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
      auditStartYear: null,
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

  it('uses the acting deployment app audit_start_year, not the candidate sibling app audit_start_year', async () => {
    const actingAppId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'acting-app',
      environment: 'prod-gcp',
      auditStartYear: 2020,
    })
    const siblingAppId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'sibling-app',
      environment: 'prod-gcp',
      auditStartYear: 2030,
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
    const siblingDeploymentId = await seedDeployment(pool, {
      monitoredAppId: siblingAppId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'sibsha11aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-01T10:00:00Z'),
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
  })
})
