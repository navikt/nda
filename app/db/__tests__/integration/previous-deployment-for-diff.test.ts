import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

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

    const prev = await getPreviousDeploymentForDiff(firstId, 'prod-gcp')
    expect(prev).toBeNull()
  })

  it('returns previous deployment within audit window', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
      auditStartYear: 2026,
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

    const prev = await getPreviousDeploymentForDiff(secondId, 'prod-gcp')
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

    const prev = await getPreviousDeploymentForDiff(newId, 'prod-gcp')
    expect(prev).toBeNull()
  })

  it('skips deployments with refs/* commit_sha', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
      auditStartYear: null,
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

    const prev = await getPreviousDeploymentForDiff(newId, 'prod-gcp')
    expect(prev).toBeNull()
  })

  it('does not respect environment for monitored_app_id (only the deployment table env)', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedDeployment(pool, {
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

    const prev = await getPreviousDeploymentForDiff(prodId, 'prod-gcp')
    expect(prev).toBeNull()
  })
})
