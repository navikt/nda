import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { UserIdentity } from '~/lib/auth.server'
import {
  getAffectedAppsForRepositoryId,
  getEffectiveAuditStartYear,
  getEffectiveDefaultBranch,
  getEffectiveImplicitApprovalSettings,
  getEffectiveSettingsForApp,
  getEffectiveSettingsForApps,
  getRepoConfigAuditLog,
  getRepositoryByOwnerRepo,
  getRepositoryIdForApp,
  REPOSITORY_SETTING_KEYS,
  recordRepoConfigAuditLog,
  syncRepositoryDefaultBranch,
  updateRepositorySettings,
  updateRepositorySettingsByRepositoryId,
} from '../../repositories.server'
import { seedApp, seedApplicationRepository, seedRepository, truncateAllTables } from './helpers'

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

async function getAppRow(appId: number): Promise<{ default_branch: string | null }> {
  const { rows } = await pool.query<{ default_branch: string | null }>(
    `SELECT default_branch FROM monitored_applications WHERE id = $1`,
    [appId],
  )
  return rows[0]
}

describe('effective repository settings resolution', () => {
  it('returns null audit_start_year and off implicit approval when the active repo row has no github_repo_id', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-fjord',
      appName: 'app-fjord',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'fjord',
    })

    const effective = await getEffectiveSettingsForApp(appId)
    expect(effective.repositoryId).toBeNull()
    expect(effective.auditStartYear).toBeNull()
    expect(effective.implicitApprovalSettings).toEqual({ mode: 'off' })
    expect(effective.defaultBranch).toBe('main')
  })

  it('returns null audit_start_year when the repo id exists but no repositories row is linked', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-elv',
      appName: 'app-elv',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'elv',
      githubRepoId: '4001',
    })

    expect(await getEffectiveAuditStartYear(appId)).toBeNull()
    expect(await getRepositoryIdForApp(appId)).toBeNull()
  })

  it('prefers repository values once linked', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-skog',
      appName: 'app-skog',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'skog',
      githubRepoId: '4002',
    })
    const repositoryId = await seedRepository(pool, {
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
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'vann',
      githubRepoId: '4003',
    })
    await seedRepository(pool, {
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
    })
    const unlinkedApp = await seedApp(pool, {
      teamSlug: 'team-bulk',
      appName: 'app-unlinked',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: linkedApp,
      githubOwner: 'navikt',
      githubRepo: 'bulk',
      githubRepoId: '4004',
    })
    await seedRepository(pool, {
      githubRepoId: '4004',
      githubOwner: 'navikt',
      githubRepoName: 'bulk',
      auditStartYear: 2020,
      implicitApprovalMode: 'dependabot_only',
    })

    const map = await getEffectiveSettingsForApps([linkedApp, unlinkedApp])
    expect(map.get(linkedApp)?.auditStartYear).toBe(2020)
    expect(map.get(linkedApp)?.implicitApprovalSettings).toEqual({ mode: 'dependabot_only' })
    expect(map.get(unlinkedApp)?.auditStartYear).toBeNull()
    expect(map.get(unlinkedApp)?.implicitApprovalSettings).toEqual({ mode: 'off' })
  })

  it('returns an empty map for an empty id list', async () => {
    expect(await getEffectiveSettingsForApps([])).toEqual(new Map())
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
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-b',
      environment: 'prod-gcp',
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

    expect(await getAppRow(appB)).toEqual({ default_branch: 'trunk' })

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
    await seedRepository(pool, {
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

describe('updateRepositorySettingsByRepositoryId', () => {
  it('rejects an unknown repository id', async () => {
    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId: 999999,
      patch: { auditStartYear: 2025 },
      changedByNavIdent: 'Z990001',
      actor: adminActor,
    })
    expect(result).toEqual({ ok: false, reason: 'repo_not_found' })
  })

  it('reports repo_not_linked when no active app is linked to the repository', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '4040',
      githubOwner: 'navikt',
      githubRepoName: 'orphan-repo',
    })

    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { auditStartYear: 2025 },
      changedByNavIdent: 'Z990001',
      actor: adminActor,
    })
    expect(result).toEqual({ ok: false, reason: 'repo_not_linked' })
  })

  it('updates settings for every app linked to the repository', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-mono-r', appName: 'app-r-a', environment: 'prod-gcp' })
    const appB = await seedApp(pool, { teamSlug: 'team-mono-r', appName: 'app-r-b', environment: 'prod-gcp' })
    for (const appId of [appA, appB]) {
      await seedApplicationRepository(pool, {
        monitoredAppId: appId,
        githubOwner: 'navikt',
        githubRepo: 'mono-by-repo-id',
        githubRepoId: '4041',
      })
    }
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '4041',
      githubOwner: 'navikt',
      githubRepoName: 'mono-by-repo-id',
    })

    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { auditStartYear: 2023, implicitApprovalMode: 'all', defaultBranch: 'develop' },
      changedByNavIdent: 'Z990099',
      actor: adminActor,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repositoryId).toBe(repositoryId)
    expect(result.affectedApps.map((app) => app.id).sort()).toEqual([appA, appB].sort())
    expect(await getEffectiveAuditStartYear(appA)).toBe(2023)
    expect(await getEffectiveImplicitApprovalSettings(appB)).toEqual({ mode: 'all' })
    expect(await getEffectiveDefaultBranch(appB)).toBe('develop')
  })

  it('rejects the update when the actor has no admin access to any linked app', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-unauth-r', appName: 'app-unauth-r', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'unauth-repo',
      githubRepoId: '4042',
    })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '4042',
      githubOwner: 'navikt',
      githubRepoName: 'unauth-repo',
    })

    const unauthorizedActor: UserIdentity = {
      navIdent: 'Z999999',
      name: 'Unauthorized Actor',
      role: 'user',
      isActualAdmin: false,
      adminSuppressed: false,
      entraGroups: [],
    }

    const result = await updateRepositorySettingsByRepositoryId({
      repositoryId,
      patch: { auditStartYear: 2025 },
      changedByNavIdent: unauthorizedActor.navIdent,
      actor: unauthorizedActor,
    })
    expect(result).toEqual({ ok: false, reason: 'unauthorized' })
  })
})

describe('getRepoConfigAuditLog', () => {
  it('returns entries for a repository ordered newest first', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '4050',
      githubOwner: 'navikt',
      githubRepoName: 'audit-log-repo',
    })

    await recordRepoConfigAuditLog({
      repositoryId,
      settingKey: REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
      oldValue: null,
      newValue: { default_branch: 'main' },
      changedByNavIdent: 'Z990010',
    })
    await recordRepoConfigAuditLog({
      repositoryId,
      settingKey: REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
      oldValue: null,
      newValue: { audit_start_year: 2024 },
      changedByNavIdent: 'Z990011',
    })

    const entries = await getRepoConfigAuditLog(repositoryId)
    expect(entries.map((e) => e.setting_key)).toEqual([
      REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
      REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
    ])
  })

  it('returns an empty array for a repository with no logged changes', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '4051',
      githubOwner: 'navikt',
      githubRepoName: 'no-audit-log-repo',
    })
    expect(await getRepoConfigAuditLog(repositoryId)).toEqual([])
  })
})

describe('recordRepoConfigAuditLog', () => {
  it('stores an entry keyed by repository id', async () => {
    const repositoryId = await seedRepository(pool, {
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

  it('records the previous owner/name in repository_name_history when the repo is renamed', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-rename', appName: 'app-rename', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'old-name',
      githubRepoId: '5050',
    })

    await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'main', syncedAt: new Date() })

    await pool.query(
      `UPDATE application_repositories SET github_owner = $1, github_repo_name = $2 WHERE monitored_app_id = $3`,
      ['navikt', 'new-name', appId],
    )

    await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'main', syncedAt: new Date() })

    const { rows } = await pool.query<{ github_owner: string; github_repo_name: string }>(
      `SELECT rnh.github_owner, rnh.github_repo_name FROM repository_name_history rnh
       JOIN repositories r ON r.id = rnh.repository_id
       WHERE r.github_repo_id = $1`,
      ['5050'],
    )
    expect(rows).toEqual([{ github_owner: 'navikt', github_repo_name: 'old-name' }])

    const { rows: repoRows } = await pool.query<{ github_repo_name: string }>(
      `SELECT github_repo_name FROM repositories WHERE github_repo_id = $1`,
      ['5050'],
    )
    expect(repoRows[0].github_repo_name).toBe('new-name')
  })
})

describe('getRepositoryByOwnerRepo', () => {
  it('returns found with the repository row when the owner/repo matches the current name', async () => {
    await seedRepository(pool, { githubRepoId: '6060', githubOwner: 'navikt', githubRepoName: 'current-name' })

    const result = await getRepositoryByOwnerRepo('navikt', 'current-name')
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.repository.github_repo_id).toBe('6060')
    }
  })

  it('returns redirect with the current owner/repo when looked up by a historical name', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-hist', appName: 'app-hist', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'old-repo-name',
      githubRepoId: '6070',
    })
    await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'main', syncedAt: new Date() })

    await pool.query(
      `UPDATE application_repositories SET github_owner = $1, github_repo_name = $2 WHERE monitored_app_id = $3`,
      ['navikt', 'renamed-repo', appId],
    )
    await syncRepositoryDefaultBranch({ monitoredAppId: appId, defaultBranch: 'main', syncedAt: new Date() })

    const result = await getRepositoryByOwnerRepo('navikt', 'old-repo-name')
    expect(result).toEqual({ status: 'redirect', githubOwner: 'navikt', githubRepoName: 'renamed-repo' })
  })

  it('returns not_found when no repository or history entry matches', async () => {
    const result = await getRepositoryByOwnerRepo('navikt', 'does-not-exist')
    expect(result).toEqual({ status: 'not_found' })
  })
})

describe('getAffectedAppsForRepositoryId', () => {
  it('returns only active apps with active repository links for the given repository', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '7070',
      githubOwner: 'navikt',
      githubRepoName: 'shared-repo',
    })
    const activeAppId = await seedApp(pool, { teamSlug: 'team-active', appName: 'app-active', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: activeAppId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo',
      githubRepoId: '7070',
      status: 'active',
    })

    const inactiveAppId = await seedApp(pool, {
      teamSlug: 'team-inactive',
      appName: 'app-inactive',
      environment: 'prod-gcp',
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: inactiveAppId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo',
      githubRepoId: '7070',
      status: 'active',
    })

    const historicalAppId = await seedApp(pool, {
      teamSlug: 'team-historical',
      appName: 'app-historical',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: historicalAppId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo',
      githubRepoId: '7070',
      status: 'historical',
    })

    const affectedApps = await getAffectedAppsForRepositoryId(repositoryId)
    expect(affectedApps).toEqual([
      { id: activeAppId, app_name: 'app-active', team_slug: 'team-active', environment_name: 'prod-gcp' },
    ])
  })

  it('returns an empty array when no apps are linked to the repository', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '7080',
      githubOwner: 'navikt',
      githubRepoName: 'unlinked-repo',
    })

    expect(await getAffectedAppsForRepositoryId(repositoryId)).toEqual([])
  })

  it('excludes an app whose latest active link (by created_at) points to a different repository', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '7090',
      githubOwner: 'navikt',
      githubRepoName: 'target-repo',
    })
    const appId = await seedApp(pool, { teamSlug: 'team-moved', appName: 'app-moved', environment: 'prod-gcp' })

    const olderLinkId = await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'target-repo',
      githubRepoId: '7090',
      status: 'active',
    })
    const newerLinkId = await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'other-repo',
      githubRepoId: '7091',
      status: 'active',
    })
    await pool.query(`UPDATE application_repositories SET created_at = now() - interval '1 day' WHERE id = $1`, [
      olderLinkId,
    ])
    await pool.query(`UPDATE application_repositories SET created_at = now() WHERE id = $1`, [newerLinkId])

    expect(await getAffectedAppsForRepositoryId(repositoryId)).toEqual([])
  })
})
