import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'
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

async function getDiffCount(appId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM verification_diffs WHERE monitored_app_id = $1`,
    [appId],
  )
  return parseInt(rows[0].count, 10)
}

describe('computeVerificationDiffs admin-approval skip', () => {
  const owner = 'navikt'
  const repo = 'pensjon-selvbetjening-soknad-alder-frontend'

  it('skips deployments with four_eyes_status = "baseline"', async () => {
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
      commitSha: 'baseline1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T13:57:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: owner,
      githubRepo: repo,
    })

    const result = await computeVerificationDiffs(appId)

    expect(result.skipped).toBe(1)
    expect(result.deploymentsChecked).toBe(1)
    expect(result.diffsFound).toBe(0)
    expect(await getDiffCount(appId)).toBe(0)
  })

  it('skips deployments with four_eyes_status = "manually_approved"', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'pensjonselvbetjening',
      appName: 'pensjon-app-2',
      environment: 'prod-gcp',
      auditStartYear: 2026,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'pensjonselvbetjening',
      environment: 'prod-gcp',
      commitSha: 'manual1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-01-15T13:57:00Z'),
      fourEyesStatus: 'manually_approved',
      githubOwner: owner,
      githubRepo: repo,
    })

    const result = await computeVerificationDiffs(appId)

    expect(result.skipped).toBe(1)
    expect(result.diffsFound).toBe(0)
    expect(await getDiffCount(appId)).toBe(0)
  })
})
