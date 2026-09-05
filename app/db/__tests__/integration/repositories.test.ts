import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getAffectedAppsForRepo,
  getEffectiveAuditStartYear,
  getEffectiveDefaultBranch,
  getEffectiveImplicitApprovalSettings,
  getEffectiveSettingsForApp,
  getEffectiveSettingsForApps,
  getRepositoryIdForApp,
  REPOSITORY_SETTING_KEYS,
  recordRepoConfigAuditLog,
  syncRepositoryDefaultBranch,
  updateRepositorySettings,
} from '../../repositories.server'
import { seedApp, seedApplicationRepository, truncateAllTables } from './helpers'

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

async function seedRepository(opts: {
  githubRepoId: string
  githubOwner: string
  githubRepoName: string
  auditStartYear?: number | null
  implicitApprovalMode?: string
  defaultBranch?: string | null
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO repositories (github_repo_id, github_owner, github_repo_name, audit_start_year, implicit_approval_mode, default_branch)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.githubRepoId,
      opts.githubOwner,
      opts.githubRepoName,
      opts.auditStartYear ?? null,
      opts.implicitApprovalMode ?? 'off',
      opts.defaultBranch ?? null,
    ],
  )
  return rows[0].id
}

async function setAppImplicitApproval(appId: number, mode: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (monitored_app_id, setting_key, setting_value)
     VALUES ($1, 'implicit_approval', $2::jsonb)
     ON CONFLICT (monitored_app_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
    [appId, JSON.stringify({ mode })],
  )
}

async function getAppRow(appId: number): Promise<{ audit_start_year: number | null; default_branch: string | null }> {
  const { rows } = await pool.query<{ audit_start_year: number | null; default_branch: string | null }>(
    `SELECT audit_start_year, default_branch FROM monitored_applications WHERE id = $1`,
    [appId],
  )
  return rows[0]
}

describe('effective repository settings resolution', () => {
  it('falls back to the app columns when the active repo row has no github_repo_id', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-fjord',
      appName: 'app-fjord',
      environment: 'prod-gcp',
      auditStartYear: 2025,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'fjord',
    })
    await setAppImplicitApproval(appId, 'all')

    const effective = await getEffectiveSettingsForApp(appId)
    expect(effective.repositoryId).toBeNull()
    expect(effective.auditStartYear).toBe(2025)
    expect(effective.implicitApprovalSettings).toEqual({ mode: 'all' })
    expect(effective.defaultBranch).toBe('main')
  })

  it('falls back to the app columns when the repo id exists but no repositories row is linked', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-elv',
      appName: 'app-elv',
      environment: 'prod-gcp',
      auditStartYear: 2023,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'elv',
      githubRepoId: '4001',
    })

    expect(await getEffectiveAuditStartYear(appId)).toBe(2023)
    expect(await getRepositoryIdForApp(appId)).toBeNull()
  })

  it('prefers repository values over the app columns when linked', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-skog',
      appName: 'app-skog',
      environment: 'prod-gcp',
      auditStartYear: 2026,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'skog',
      githubRepoId: '4002',
    })
    await setAppImplicitApproval(appId, 'all')
    const repositoryId = await seedRepository({
      githubRepoId: '4002',
      githubOwner: 'navikt',
      githubRepoName: 'skog',
      auditStartYear: 2024,
      implicitApprovalMode: 'off',
      defaultBranch: 'trunk',
    })

    expect(await getRepositoryIdForApp(appId)).toBe(repositoryId)
    expect(await getEffectiveAuditStartYear(appId)).toBe(2024)
    expect(await getEffectiveImplicitApprovalSettings(appId)).toEqual({ mode: 'off' })
    expect(await getEffectiveDefaultBranch(appId)).toBe('trunk')
  })

  it('treats repository audit_start_year as authoritative (even null) but falls back per-app for default_branch', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-vann',
      appName: 'app-vann',
      environment: 'prod-gcp',
      auditStartYear: 2022,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'vann',
      githubRepoId: '4003',
    })
    await seedRepository({
      githubRepoId: '4003',
      githubOwner: 'navikt',
      githubRepoName: 'vann',
      auditStartYear: null,
      defaultBranch: null,
    })

    expect(await getEffectiveAuditStartYear(appId)).toBeNull()
    expect(await getEffectiveDefaultBranch(appId)).toBe('main')
  })

  it('resolves settings in bulk for several apps at once', async () => {
    const linkedApp = await seedApp(pool, {
      teamSlug: 'team-bulk',
      appName: 'app-linked',
      environment: 'prod-gcp',
      auditStartYear: 2026,
    })
    const unlinkedApp = await seedApp(pool, {
      teamSlug: 'team-bulk',
      appName: 'app-unlinked',
      environment: 'prod-gcp',
      auditStartYear: 2021,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: linkedApp,
      githubOwner: 'navikt',
      githubRepo: 'bulk',
      githubRepoId: '4004',
    })
    await seedRepository({
      githubRepoId: '4004',
      githubOwner: 'navikt',
      githubRepoName: 'bulk',
      auditStartYear: 2020,
      implicitApprovalMode: 'dependabot_only',
    })

    const map = await getEffectiveSettingsForApps([linkedApp, unlinkedApp])
    expect(map.get(linkedApp)?.auditStartYear).toBe(2020)
    expect(map.get(linkedApp)?.implicitApprovalSettings).toEqual({ mode: 'dependabot_only' })
    expect(map.get(unlinkedApp)?.auditStartYear).toBe(2021)
    expect(map.get(unlinkedApp)?.implicitApprovalSettings).toEqual({ mode: 'off' })
  })

  it('returns an empty map for an empty id list', async () => {
    expect(await getEffectiveSettingsForApps([])).toEqual(new Map())
  })
})

describe('getAffectedAppsForRepo', () => {
  it('returns every active app sharing the same github_repo_id', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    const other = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-gcp' })
    for (const [appId, repoId] of [
      [appA, '4010'],
      [appB, '4010'],
      [other, '4011'],
    ] as const) {
      await seedApplicationRepository(pool, {
        monitoredAppId: appId,
        githubOwner: 'navikt',
        githubRepo: repoId === '4010' ? 'mono' : 'solo',
        githubRepoId: repoId,
      })
    }

    const affected = await getAffectedAppsForRepo(appA)
    expect(affected.map((app) => app.id).sort()).toEqual([appA, appB].sort())
  })

  it('returns an empty list when the repo is not linked', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'app-x', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: 'navikt', githubRepo: 'x' })
    expect(await getAffectedAppsForRepo(appId)).toEqual([])
  })
})

describe('updateRepositorySettings', () => {
  it('rejects an unknown application', async () => {
    const result = await updateRepositorySettings({
      monitoredAppId: 999999,
      patch: { auditStartYear: 2025 },
      changedByNavIdent: 'Z990001',
    })
    expect(result).toEqual({ ok: false, reason: 'app_not_found' })
  })

  it('reports repo_not_linked when the active repo row has no github_repo_id', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-nolink', appName: 'app-nolink', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: 'navikt', githubRepo: 'nolink' })

    const result = await updateRepositorySettings({
      monitoredAppId: appId,
      patch: { auditStartYear: 2025 },
      changedByNavIdent: 'Z990001',
    })
    expect(result).toEqual({ ok: false, reason: 'repo_not_linked' })
  })

  it('creates the repositories row, writes the audit log and mirrors to every sibling app', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-a',
      environment: 'prod-gcp',
      auditStartYear: 2026,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-b',
      environment: 'prod-gcp',
      auditStartYear: 2027,
    })
    for (const appId of [appA, appB]) {
      await seedApplicationRepository(pool, {
        monitoredAppId: appId,
        githubOwner: 'navikt',
        githubRepo: 'mono',
        githubRepoId: '4020',
      })
    }

    const result = await updateRepositorySettings({
      monitoredAppId: appA,
      patch: { auditStartYear: 2024, implicitApprovalMode: 'dependabot_only', defaultBranch: 'trunk' },
      changedByNavIdent: 'Z990042',
      changedByName: 'Glad Fjord',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.changedKeys).toEqual([
      REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
      REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL,
      REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
    ])
    expect(result.affectedApps.map((app) => app.id).sort()).toEqual([appA, appB].sort())
    expect(result.auditStartYearChange?.updatedAppIds.sort()).toEqual([appA, appB].sort())

    expect(await getEffectiveAuditStartYear(appB)).toBe(2024)
    expect(await getEffectiveImplicitApprovalSettings(appB)).toEqual({ mode: 'dependabot_only' })
    expect(await getEffectiveDefaultBranch(appB)).toBe('trunk')

    expect(await getAppRow(appB)).toEqual({ audit_start_year: 2024, default_branch: 'trunk' })

    const { rows: auditRows } = await pool.query<{ setting_key: string; new_value: Record<string, unknown> }>(
      `SELECT setting_key, new_value FROM repo_config_audit_log WHERE repository_id = $1 ORDER BY id`,
      [result.repositoryId],
    )
    expect(auditRows.map((row) => row.setting_key)).toEqual([
      REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
      REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL,
      REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
    ])

    const { rows: legacyRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM app_config_audit_log`,
    )
    expect(legacyRows[0].count).toBe('0')
  })

  it('reports no changed keys when the patch matches the stored values', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-noop', appName: 'app-noop', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'noop',
      githubRepoId: '4021',
    })
    await seedRepository({
      githubRepoId: '4021',
      githubOwner: 'navikt',
      githubRepoName: 'noop',
      auditStartYear: 2024,
      implicitApprovalMode: 'off',
      defaultBranch: 'main',
    })

    const result = await updateRepositorySettings({
      monitoredAppId: appId,
      patch: { auditStartYear: 2024, implicitApprovalMode: 'off', defaultBranch: 'main' },
      changedByNavIdent: 'Z990001',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changedKeys).toEqual([])
    expect(result.auditStartYearChange).toBeNull()
  })
})

describe('recordRepoConfigAuditLog', () => {
  it('stores an entry keyed by repository id', async () => {
    const repositoryId = await seedRepository({
      githubRepoId: '4030',
      githubOwner: 'navikt',
      githubRepoName: 'log',
    })

    await recordRepoConfigAuditLog({
      repositoryId,
      settingKey: REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
      oldValue: { default_branch: 'master' },
      newValue: { default_branch: 'main' },
      changedByNavIdent: 'Z990007',
      changedByName: 'Rask Elv',
      changeReason: 'Rebranding',
    })

    const { rows } = await pool.query<{
      setting_key: string
      changed_by_name: string
      change_reason: string
      old_value: Record<string, unknown>
    }>(
      `SELECT setting_key, changed_by_name, change_reason, old_value FROM repo_config_audit_log WHERE repository_id = $1`,
      [repositoryId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].setting_key).toBe(REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH)
    expect(rows[0].changed_by_name).toBe('Rask Elv')
    expect(rows[0].change_reason).toBe('Rebranding')
    expect(rows[0].old_value).toEqual({ default_branch: 'master' })
  })
})

describe('syncRepositoryDefaultBranch', () => {
  it('creates the repositories row and stores the branch', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-sync', appName: 'app-sync', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'sync',
      githubRepoId: '4040',
    })

    expect(
      await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'trunk', syncedAt: new Date() }),
    ).toBe(true)
    expect(await getEffectiveDefaultBranch(appId)).toBe('trunk')
  })

  it('does nothing when the repo is not linked', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-sync2', appName: 'app-sync2', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: 'navikt', githubRepo: 'sync2' })

    expect(
      await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'trunk', syncedAt: new Date() }),
    ).toBe(false)
  })
})
