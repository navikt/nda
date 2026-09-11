import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { UserIdentity } from '~/lib/auth.server'
import {
  type AuditStartYearChangeResult,
  applyAuditStartYearChangeForApps,
} from '../../audit-start-year-baseline.server'
import { withTransaction } from '../../connection.server'
import {
  getEffectiveAuditStartYear,
  syncRepositoryDefaultBranch,
  updateRepositorySettingsByRepositoryId,
} from '../../repositories.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const adminActor: UserIdentity = {
  navIdent: 'Z990001',
  name: 'Admin Actor',
  role: 'admin',
  isActualAdmin: true,
  adminSuppressed: false,
  entraGroups: [],
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

async function getStatus(deploymentId: number): Promise<string> {
  const { rows } = await pool.query<{ four_eyes_status: string }>(
    `SELECT four_eyes_status FROM deployments WHERE id = $1`,
    [deploymentId],
  )
  return rows[0].four_eyes_status
}

async function getAuditStartYear(appId: number): Promise<number | null> {
  return getEffectiveAuditStartYear(appId)
}

async function applyAuditStartYearChange(
  appId: number,
  newAuditStartYear: number | null,
  adminNavIdent: string,
): Promise<AuditStartYearChangeResult> {
  return withTransaction(async (client) => {
    const { rows: linkRows } = await client.query<{ github_repo_id: string }>(
      `SELECT github_repo_id FROM application_repositories
       WHERE monitored_app_id = $1 AND status = 'active' AND github_repo_id IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [appId],
    )
    const githubRepoId = linkRows[0]?.github_repo_id ?? null

    let targetAppIds = [appId]
    let previousAuditStartYear: number | null = null
    let repositoryId: number | null = null

    if (githubRepoId) {
      const { rows: appIdRows } = await client.query<{ id: number }>(
        `SELECT DISTINCT ma.id
         FROM application_repositories ar
         JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
         WHERE ar.status = 'active' AND ma.is_active = true AND ar.github_repo_id = $1`,
        [githubRepoId],
      )
      targetAppIds = appIdRows.map((row) => row.id)
      if (!targetAppIds.includes(appId)) targetAppIds.push(appId)

      const { rows: repoRows } = await client.query<{ id: number; audit_start_year: number | null }>(
        `SELECT id, audit_start_year FROM repositories WHERE github_repo_id = $1`,
        [githubRepoId],
      )
      const repoRow = repoRows[0]
      if (repoRow) {
        repositoryId = repoRow.id
        previousAuditStartYear = repoRow.audit_start_year
        await client.query(`UPDATE repositories SET audit_start_year = $1, updated_at = now() WHERE id = $2`, [
          newAuditStartYear,
          repoRow.id,
        ])
      } else {
        const { rows: insertedRows } = await client.query<{ id: number }>(
          `INSERT INTO repositories (github_repo_id, github_owner, github_repo_name, audit_start_year)
           SELECT github_repo_id, github_owner, github_repo_name, $2
           FROM application_repositories
           WHERE monitored_app_id = $1 AND status = 'active' AND github_repo_id = $3
           LIMIT 1
           RETURNING id`,
          [appId, newAuditStartYear, githubRepoId],
        )
        repositoryId = insertedRows[0]?.id ?? null
      }
    }

    const result = await applyAuditStartYearChangeForApps(
      client,
      appId,
      targetAppIds,
      previousAuditStartYear,
      newAuditStartYear,
      adminNavIdent,
    )
    void repositoryId
    return result
  })
}

describe('applyAuditStartYearChange', () => {
  it('proposes the first deployment of the new year as baseline when none existed before', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-a',
      githubRepoId: '900101',
    })
    const before = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'app-a',
    })
    const firstInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'app-a',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(firstInYear)
    expect(result.demotedDeploymentIds).toEqual([])
    expect(await getStatus(firstInYear)).toBe('pending_baseline')
    expect(await getStatus(before)).toBe('approved_pr')
    expect(await getAuditStartYear(appId)).toBe(2026)
  })

  it('does not promote a deployment with an unauthorized_repository or unauthorized_branch status to pending_baseline', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a2',
      appName: 'app-a2',
      environment: 'prod',
    })
    const unauthorizedRepo = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a2',
      environment: 'prod',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'unauthorized_repository',
    })
    const unauthorizedBranch = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a2',
      environment: 'prod',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'unauthorized_branch',
    })
    const firstEligibleInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a2',
      environment: 'prod',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(firstEligibleInYear)
    expect(await getStatus(unauthorizedRepo)).toBe('unauthorized_repository')
    expect(await getStatus(unauthorizedBranch)).toBe('unauthorized_branch')
    expect(await getStatus(firstEligibleInYear)).toBe('pending_baseline')
  })

  it('is a no-op when the current baseline marker is already the correct first deployment', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-b',
      githubRepoId: '9500',
    })
    await seedRepository(pool, {
      githubRepoId: '9500',
      githubOwner: 'navikt',
      githubRepoName: 'app-b',
      auditStartYear: 2026,
    })
    const baseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'app-b',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBeNull()
    expect(result.demotedDeploymentIds).toEqual([])
    expect(await getStatus(baseline)).toBe('baseline')
  })

  it('demotes an approved baseline to manually_approved and promotes the new first deployment when the year moves earlier', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-c',
      appName: 'app-c',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-c',
      githubRepoId: '9501',
    })
    await seedRepository(pool, {
      githubRepoId: '9501',
      githubOwner: 'navikt',
      githubRepoName: 'app-c',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'app-c',
    })
    const oldBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'app-c',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentIds).toEqual([oldBaseline])
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(oldBaseline)).toBe('manually_approved')

    const { rows } = await pool.query(
      `SELECT from_status, to_status, changed_by, change_source FROM deployment_status_history
       WHERE deployment_id = $1 ORDER BY id`,
      [oldBaseline],
    )
    expect(rows).toEqual([
      expect.objectContaining({
        from_status: 'baseline',
        to_status: 'manually_approved',
        changed_by: 'Z990001',
        change_source: 'audit_start_year_change',
      }),
    ])
  })

  it('demotes every stale marker when the app has more than one deployment marked baseline/pending_baseline', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-c2',
      appName: 'app-c2',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-c2',
      githubRepoId: '9502',
    })
    await seedRepository(pool, {
      githubRepoId: '9502',
      githubOwner: 'navikt',
      githubRepoName: 'app-c2',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c2',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'app-c2',
    })
    const staleBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c2',
      environment: 'prod',
      createdAt: new Date('2025-06-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'app-c2',
    })
    const stalePendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c2',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
      githubOwner: 'navikt',
      githubRepo: 'app-c2',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentIds.sort()).toEqual([staleBaseline, stalePendingBaseline].sort())
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(staleBaseline)).toBe('manually_approved')
    expect(await getStatus(stalePendingBaseline)).toBe('pending')
  })

  it('sends an unapproved pending_baseline marker back to normal verification when it is no longer first', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-d',
      appName: 'app-d',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-d',
      githubRepoId: '9503',
    })
    await seedRepository(pool, {
      githubRepoId: '9503',
      githubOwner: 'navikt',
      githubRepoName: 'app-d',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'app-d',
    })
    const oldPendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
      githubOwner: 'navikt',
      githubRepo: 'app-d',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentIds).toEqual([oldPendingBaseline])
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(oldPendingBaseline)).toBe('pending')
  })

  it('demotes the old marker and leaves no promotion when no deployment exists in the new scope', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-e',
      appName: 'app-e',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'app-e',
      githubRepoId: '9504',
    })
    await seedRepository(pool, {
      githubRepoId: '9504',
      githubOwner: 'navikt',
      githubRepoName: 'app-e',
      auditStartYear: 2025,
    })
    const oldPendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-e',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2030, 'Z990001')

    expect(result.promotedDeploymentId).toBeNull()
    expect(result.demotedDeploymentIds).toEqual([oldPendingBaseline])
    expect(await getStatus(oldPendingBaseline)).toBe('pending')
  })

  it('cascades the new year to repo siblings and recomputes baseline across the repo', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-f',
      appName: 'app-f-1',
      environment: 'prod-fss',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-f',
      appName: 'app-f-2',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '901',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '901',
    })

    const beforeYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-f',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })
    const firstInYearSibling = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-f',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds.sort()).toEqual([appA, appB].sort())
    expect(result.promotedDeploymentId).toBe(firstInYearSibling)
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBe(2026)
    expect(await getStatus(firstInYearSibling)).toBe('pending_baseline')
    expect(await getStatus(beforeYear)).toBe('approved_pr')
  })

  it('recomputes baseline for the whole repo scope', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g',
      appName: 'app-g-1',
      environment: 'prod-fss',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g',
      appName: 'app-g-2',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '902',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '902',
    })

    const appAFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g',
      environment: 'prod-fss',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })
    const appBEarlierInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(appBEarlierInYear)
    expect(await getStatus(appBEarlierInYear)).toBe('pending_baseline')
    expect(await getStatus(appAFirstInYear)).toBe('approved_pr')
  })

  it('demotes an old baseline marker with unknown (NULL) detected repo even when a repo scope is known', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g2',
      appName: 'app-g2-1',
      environment: 'prod-fss',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g2',
      appName: 'app-g2-2',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-2',
      githubRepoId: '903',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-2',
      githubRepoId: '903',
    })

    const oldBaselineWithUnknownRepo = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g2',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    const newFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g2',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app-2',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([oldBaselineWithUnknownRepo])
    expect(result.promotedDeploymentId).toBe(newFirstInYear)
    expect(await getStatus(oldBaselineWithUnknownRepo)).toBe('manually_approved')
    expect(await getStatus(newFirstInYear)).toBe('pending_baseline')
  })

  it('does not treat a marker with only a partially unknown detected repo as in-scope for demotion', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g2b',
      appName: 'app-g2b-1',
      environment: 'prod-fss',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g2b',
      appName: 'app-g2b-2',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-3',
      githubRepoId: '904',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-3',
      githubRepoId: '904',
    })

    const partiallyUnknownBaseline = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g2b',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'other-repo',
    })
    await pool.query(`UPDATE deployments SET detected_github_repo_name = NULL WHERE id = $1`, [
      partiallyUnknownBaseline,
    ])

    const newFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g2b',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app-3',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([])
    expect(result.promotedDeploymentId).toBe(newFirstInYear)
    expect(await getStatus(partiallyUnknownBaseline)).toBe('baseline')
    expect(await getStatus(newFirstInYear)).toBe('pending_baseline')
  })

  it('skips baseline recompute entirely when the acting app has more than one distinct active repo (ambiguous scope)', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g3',
      appName: 'app-g3-1',
      environment: 'prod-fss',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-one',
      githubRepoId: '900201',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-two',
      githubRepoId: '900202',
    })

    const appABaseline = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g3',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'repo-one',
    })
    const appAFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g3',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-one',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.recomputeSkippedDueToAmbiguousRepoScope).toBe(true)
    expect(result.demotedDeploymentIds).toEqual([])
    expect(result.promotedDeploymentId).toBeNull()
    expect(await getStatus(appABaseline)).toBe('baseline')
    expect(await getStatus(appAFirstInYear)).toBe('approved_pr')
    expect(await getAuditStartYear(appA)).toBe(2026)
  })

  it('cascades the new year to a monorepo sibling sharing the same github_repo_id, without any application group', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-mono-backend',
      environment: 'prod-gcp',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-mono-frontend',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '555',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '555',
    })

    const beforeYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-mono',
      environment: 'prod-gcp',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const firstInYearSibling = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-mono',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds.sort()).toEqual([appA, appB].sort())
    expect(result.promotedDeploymentId).toBe(firstInYearSibling)
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBe(2026)
    expect(await getStatus(firstInYearSibling)).toBe('pending_baseline')
    expect(await getStatus(beforeYear)).toBe('approved_pr')
  })

  it('does not cascade to another app in the same owner/repo string if github_repo_id differs', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono2',
      appName: 'app-mono2-a',
      environment: 'prod-gcp',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono2',
      appName: 'app-mono2-b',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'ambiguous-repo',
      githubRepoId: '111',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'ambiguous-repo',
      githubRepoId: '222',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds).toEqual([appA])
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBeNull()
  })

  it('recomputes baseline only for active monorepo siblings, but repo-scoped audit_start_year applies to inactive siblings too', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono3',
      appName: 'app-mono3-active',
      environment: 'prod-gcp',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono3',
      appName: 'app-mono3-inactive',
      environment: 'prod-gcp',
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-with-inactive',
      githubRepoId: '777',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-with-inactive',
      githubRepoId: '777',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds).toEqual([appA])
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBe(2026)
  })

  it('still recomputes baseline for a sibling app when the acting app itself has no deployments yet', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h-1',
      environment: 'prod-fss',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h-2',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-b',
      githubRepoId: '905',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'repo-b',
      githubRepoId: '905',
    })

    const siblingDeploy = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-h',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-b',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(siblingDeploy)
    expect(await getStatus(siblingDeploy)).toBe('pending_baseline')
  })

  it('logs the shared repository previous audit_start_year in status history for both apps', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-hi',
      appName: 'app-hi-1',
      environment: 'prod-fss',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-hi',
      appName: 'app-hi-2',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
      githubRepoId: '906',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
      githubRepoId: '906',
    })
    await seedRepository(pool, {
      githubRepoId: '906',
      githubOwner: 'navikt',
      githubRepoName: 'shared-hi',
      auditStartYear: 2023,
    })

    const groupOldBaseline = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-hi',
      environment: 'prod-gcp',
      createdAt: new Date('2023-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
    })
    const appANewFirst = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-hi',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([groupOldBaseline])
    expect(result.promotedDeploymentId).toBe(appANewFirst)

    const { rows: demotedRows } = await pool.query<{ details: { previous_audit_start_year: number | null } }>(
      `SELECT details FROM deployment_status_history WHERE deployment_id = $1 ORDER BY id`,
      [groupOldBaseline],
    )
    const { rows: promotedRows } = await pool.query<{ details: { previous_audit_start_year: number | null } }>(
      `SELECT details FROM deployment_status_history WHERE deployment_id = $1 ORDER BY id`,
      [appANewFirst],
    )

    expect(demotedRows[0]?.details.previous_audit_start_year).toBe(2023)
    expect(promotedRows[0]?.details.previous_audit_start_year).toBe(2023)
  })

  it('demotes an existing baseline marker even when it has no commit_sha', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-i',
      appName: 'app-i-1',
      environment: 'prod-fss',
    })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: 'navikt', githubRepo: 'repo-i' })

    const oldBaselineNoCommit = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-i',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      commitSha: null,
      githubOwner: 'navikt',
      githubRepo: 'repo-i',
    })
    const firstInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-i',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-i',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([oldBaselineNoCommit])
    expect(await getStatus(oldBaselineNoCommit)).toBe('manually_approved')
    expect(result.promotedDeploymentId).toBe(firstInYear)
    expect(await getStatus(firstInYear)).toBe('pending_baseline')
  })

  it('considers deployments recorded under the old owner/repo name after a rename when recomputing baseline', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-rename-baseline',
      appName: 'app-rename-baseline',
      environment: 'prod-fss',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'old-owner-repo',
      githubRepoId: '910101',
    })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '910101',
      githubOwner: 'navikt',
      githubRepoName: 'old-owner-repo',
    })

    const preRenameBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-rename-baseline',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'old-owner-repo',
    })
    const firstInYearUnderOldName = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-rename-baseline',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'old-owner-repo',
    })

    await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'main', syncedAt: new Date() })
    await pool.query(
      `UPDATE application_repositories SET github_owner = $1, github_repo_name = $2 WHERE monitored_app_id = $3`,
      ['navikt', 'renamed-repo', appId],
    )
    await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'main', syncedAt: new Date() })

    const { rows: historyRows } = await pool.query(
      `SELECT 1 FROM repository_name_history WHERE repository_id = $1 AND github_owner = 'navikt' AND github_repo_name = 'old-owner-repo'`,
      [repositoryId],
    )
    expect(historyRows).toHaveLength(1)

    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { auditStartYear: 2026 },
      changedByNavIdent: 'Z990001',
      actor: adminActor,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auditStartYearChange?.demotedDeploymentIds).toEqual([preRenameBaseline])
    expect(await getStatus(preRenameBaseline)).toBe('manually_approved')
    expect(result.auditStartYearChange?.promotedDeploymentId).toBe(firstInYearUnderOldName)
    expect(await getStatus(firstInYearUnderOldName)).toBe('pending_baseline')
  })
})
