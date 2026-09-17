import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { effectiveAuditStartYearSql, effectiveDefaultBranchSql } from '../../repository-settings-sql'
import { seedApp, seedApplicationRepository, seedRepository, truncateAllTables } from './helpers'

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

async function getEffectiveColumns(
  appId: number,
): Promise<{ audit_start_year: number | null; default_branch: string | null }> {
  const { rows } = await pool.query<{ audit_start_year: number | null; default_branch: string | null }>(
    `SELECT ${effectiveAuditStartYearSql('ma')} AS audit_start_year, ${effectiveDefaultBranchSql('ma')} AS default_branch
     FROM monitored_applications ma
     WHERE ma.id = $1`,
    [appId],
  )
  return rows[0]
}

describe('repository-settings-sql (integration)', () => {
  it('uses the newest active link even when its github_repo_id is NULL, instead of an older linked repository', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-sql', appName: 'app-sql', environment: 'prod-gcp' })

    // Older active link, fully linked to a repository with known settings.
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'old-linked-repo',
      githubRepoId: '9001',
    })
    await seedRepository(pool, {
      githubRepoId: '9001',
      githubOwner: 'navikt',
      githubRepoName: 'old-linked-repo',
      auditStartYear: 2020,
      defaultBranch: 'old-trunk',
    })

    // Newer active link inserted afterwards (backfill not yet completed for this row).
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'new-unlinked-repo',
    })

    const effective = await getEffectiveColumns(appId)

    // If the `github_repo_id IS NOT NULL` filter were still applied before ORDER BY/LIMIT, this
    // would incorrectly select the older, fully-linked repository and return 2020 / 'old-trunk'.
    expect(effective.audit_start_year).toBeNull()
    expect(effective.default_branch).toBe('main')
  })
})
