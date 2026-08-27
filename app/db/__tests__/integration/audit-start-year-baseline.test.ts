import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyAuditStartYearChange } from '../../audit-start-year-baseline.server'
import {
  assignAppToGroup,
  seedApp,
  seedApplicationGroup,
  seedApplicationRepository,
  seedDeployment,
  truncateAllTables,
} from './helpers'

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
  const { rows } = await pool.query<{ audit_start_year: number | null }>(
    `SELECT audit_start_year FROM monitored_applications WHERE id = $1`,
    [appId],
  )
  return rows[0].audit_start_year
}

describe('applyAuditStartYearChange', () => {
  it('proposes the first deployment of the new year as baseline when none existed before', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: null,
    })
    const before = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const firstInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(firstInYear)
    expect(result.demotedDeploymentId).toBeNull()
    expect(await getStatus(firstInYear)).toBe('pending_baseline')
    expect(await getStatus(before)).toBe('approved_pr')
    expect(await getAuditStartYear(appId)).toBe(2026)
  })

  it('is a no-op when the current baseline marker is already the correct first deployment', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const baseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBeNull()
    expect(result.demotedDeploymentId).toBeNull()
    expect(await getStatus(baseline)).toBe('baseline')
  })

  it('demotes an approved baseline to manually_approved and promotes the new first deployment when the year moves earlier', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-c',
      appName: 'app-c',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const oldBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentId).toBe(oldBaseline)
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

  it('sends an unapproved pending_baseline marker back to normal verification when it is no longer first', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-d',
      appName: 'app-d',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const oldPendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentId).toBe(oldPendingBaseline)
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(oldPendingBaseline)).toBe('pending')
  })

  it('demotes the old marker and leaves no promotion when no deployment exists in the new scope', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-e',
      appName: 'app-e',
      environment: 'prod',
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
    expect(result.demotedDeploymentId).toBe(oldPendingBaseline)
    expect(await getStatus(oldPendingBaseline)).toBe('pending')
  })

  it('cascades the new year to application group siblings and recomputes baseline across the group', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-1')
    const appA = await seedApp(pool, {
      teamSlug: 'team-f',
      appName: 'app-f-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-f',
      appName: 'app-f-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'shared-app' })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: 'navikt', githubRepo: 'shared-app' })

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

  it('recomputes baseline for the whole group using the group repo scope', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-2')
    const appA = await seedApp(pool, {
      teamSlug: 'team-g',
      appName: 'app-g-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g',
      appName: 'app-g-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'shared-app' })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: 'navikt', githubRepo: 'shared-app' })

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

  it('demotes an old baseline marker with unknown (NULL) detected repo even when a group repo scope is known', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-2b')
    const appA = await seedApp(pool, {
      teamSlug: 'team-g2',
      appName: 'app-g2-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g2',
      appName: 'app-g2-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'shared-app-2' })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: 'navikt', githubRepo: 'shared-app-2' })

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

    expect(result.demotedDeploymentId).toBe(oldBaselineWithUnknownRepo)
    expect(result.promotedDeploymentId).toBe(newFirstInYear)
    expect(await getStatus(oldBaselineWithUnknownRepo)).toBe('manually_approved')
    expect(await getStatus(newFirstInYear)).toBe('pending_baseline')
  })

  it('treats an unexpected data state with more than one distinct active repo in the group as unscoped', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-2c')
    const appA = await seedApp(pool, {
      teamSlug: 'team-g3',
      appName: 'app-g3-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g3',
      appName: 'app-g3-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'repo-one' })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: 'navikt', githubRepo: 'repo-two' })

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
    const appBFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g3',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-two',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentId).toBe(appABaseline)
    expect(result.promotedDeploymentId).toBe(appAFirstInYear)
    expect(await getStatus(appABaseline)).toBe('manually_approved')
    expect(await getStatus(appAFirstInYear)).toBe('pending_baseline')
    expect(await getStatus(appBFirstInYear)).toBe('approved_pr')
  })

  it('still recomputes baseline for a sibling app when the acting app itself has no deployments yet', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-3')
    const appA = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: 'navikt', githubRepo: 'repo-b' })

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

  it('recomputes only within the acting app when no group member has a known active repository yet', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-3c')
    const appA = await seedApp(pool, {
      teamSlug: 'team-hh',
      appName: 'app-hh-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-hh',
      appName: 'app-hh-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)

    const appABaseline = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-hh',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    const appAFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-hh',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const appBFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-hh',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentId).toBe(appABaseline)
    expect(result.promotedDeploymentId).toBe(appAFirstInYear)
    expect(await getStatus(appABaseline)).toBe('manually_approved')
    expect(await getStatus(appAFirstInYear)).toBe('pending_baseline')
    expect(await getStatus(appBFirstInYear)).toBe('approved_pr')
  })

  it('logs each app’s own previous audit_start_year in status history, not the acting app’s', async () => {
    const groupId = await seedApplicationGroup(pool, 'group-3d')
    const appA = await seedApp(pool, {
      teamSlug: 'team-hi',
      appName: 'app-hi-1',
      environment: 'prod-fss',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-hi',
      appName: 'app-hi-2',
      environment: 'prod-gcp',
      auditStartYear: 2023,
    })
    await assignAppToGroup(pool, appA, groupId)
    await assignAppToGroup(pool, appB, groupId)
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'shared-hi' })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: 'navikt', githubRepo: 'shared-hi' })

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

    expect(result.demotedDeploymentId).toBe(groupOldBaseline)
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
    expect(promotedRows[0]?.details.previous_audit_start_year).toBe(2024)
  })

  it('demotes an existing baseline marker even when it has no commit_sha', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-i',
      appName: 'app-i-1',
      environment: 'prod-fss',
      auditStartYear: null,
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

    expect(result.demotedDeploymentId).toBe(oldBaselineNoCommit)
    expect(await getStatus(oldBaselineNoCommit)).toBe('manually_approved')
    expect(result.promotedDeploymentId).toBe(firstInYear)
    expect(await getStatus(firstInYear)).toBe('pending_baseline')
  })
})
