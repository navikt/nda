import type { PoolClient } from 'pg'
import type { UserIdentity } from '~/lib/auth.server'
import { canAccessAppsAdmin } from '~/lib/authorization.server'
import { logger } from '~/lib/logger.server'
import { REPOSITORY_SETTING_KEYS } from '~/lib/repository-setting-keys'
import { type EffectiveRepositorySettings, resolveEffectiveSettings } from '~/lib/repository-settings'
import { type ImplicitApprovalMode, isImplicitApprovalMode } from '~/lib/verification/types'
import type { AuditStartYearChangeResult, RepoScope } from './audit-start-year-baseline.server'
import { lockAppForWrite, lockRepositoryForWrite, pool, withTransaction } from './connection.server'

export interface Repository {
  id: number
  github_repo_id: string
  github_owner: string
  github_repo_name: string
  audit_start_year: number | null
  implicit_approval_mode: ImplicitApprovalMode
  default_branch: string | null
  default_branch_synced_at: Date | null
}

export interface AffectedApp {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
}

export type RepositoryLookupResult =
  | { status: 'found'; repository: Repository }
  | { status: 'redirect'; githubOwner: string; githubRepoName: string }
  | { status: 'not_found' }

export async function getRepositoryByOwnerRepo(
  githubOwner: string,
  githubRepoName: string,
): Promise<RepositoryLookupResult> {
  const { rows } = await pool.query<Repository>(
    `SELECT * FROM repositories WHERE github_owner = $1 AND github_repo_name = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [githubOwner, githubRepoName],
  )
  const repository = rows[0]
  if (repository) {
    return { status: 'found', repository }
  }

  const { rows: historyRows } = await pool.query<{ github_owner: string; github_repo_name: string }>(
    `SELECT r.github_owner, r.github_repo_name
     FROM repository_name_history rnh
     JOIN repositories r ON r.id = rnh.repository_id
     WHERE rnh.github_owner = $1 AND rnh.github_repo_name = $2
     ORDER BY rnh.replaced_at DESC
     LIMIT 1`,
    [githubOwner, githubRepoName],
  )
  const historyMatch = historyRows[0]
  if (historyMatch) {
    return { status: 'redirect', githubOwner: historyMatch.github_owner, githubRepoName: historyMatch.github_repo_name }
  }

  return { status: 'not_found' }
}

export async function getAffectedAppsForRepositoryId(repositoryId: number): Promise<AffectedApp[]> {
  const { rows } = await pool.query<AffectedApp>(
    `SELECT ma.id, ma.app_name, ma.team_slug, ma.environment_name
     FROM (
       SELECT DISTINCT ON (monitored_app_id) monitored_app_id, github_repo_id
       FROM application_repositories
       WHERE status = 'active'
       ORDER BY monitored_app_id, created_at DESC, id DESC
     ) latest
     JOIN monitored_applications ma ON ma.id = latest.monitored_app_id
     JOIN repositories r ON r.github_repo_id = latest.github_repo_id
     WHERE ma.is_active = true AND r.id = $1
     ORDER BY ma.environment_name, ma.team_slug, ma.app_name`,
    [repositoryId],
  )
  return rows
}

export async function getRepositoryById(repositoryId: number): Promise<Repository | null> {
  const { rows } = await pool.query<Repository>(`SELECT * FROM repositories WHERE id = $1`, [repositoryId])
  return rows[0] ?? null
}

export async function isCurrentOrHistoricalNameForRepositoryId(
  repositoryId: number,
  githubOwner: string,
  githubRepoName: string,
): Promise<boolean> {
  const { rows: currentRows } = await pool.query<{ id: number }>(
    `SELECT id FROM repositories WHERE id = $1 AND github_owner = $2 AND github_repo_name = $3`,
    [repositoryId, githubOwner, githubRepoName],
  )
  if (currentRows.length > 0) return true

  const { rows: historyRows } = await pool.query<{ id: number }>(
    `SELECT repository_id AS id FROM repository_name_history
     WHERE repository_id = $1 AND github_owner = $2 AND github_repo_name = $3`,
    [repositoryId, githubOwner, githubRepoName],
  )
  return historyRows.length > 0
}

export { REPOSITORY_SETTING_KEYS }

type Queryable = Pick<PoolClient, 'query'>

async function applyAuditStartYearChangeForAppsLazy(
  client: PoolClient,
  appId: number,
  targetAppIds: number[],
  previousAuditStartYear: number | null,
  newAuditStartYear: number | null,
  adminNavIdent: string,
  explicitRepoScope?: RepoScope,
): Promise<AuditStartYearChangeResult> {
  const { applyAuditStartYearChangeForApps } = await import('./audit-start-year-baseline.server')
  return applyAuditStartYearChangeForApps(
    client,
    appId,
    targetAppIds,
    previousAuditStartYear,
    newAuditStartYear,
    adminNavIdent,
    explicitRepoScope,
  )
}

interface EffectiveSettingsRow {
  monitored_app_id: number
  app_default_branch: string | null
  repository_id: number | null
  repo_audit_start_year: number | null
  repo_implicit_approval_mode: string | null
  repo_default_branch: string | null
}

const EFFECTIVE_SETTINGS_SELECT = `
  SELECT ma.id AS monitored_app_id,
         ma.default_branch AS app_default_branch,
         r.id AS repository_id,
         r.audit_start_year AS repo_audit_start_year,
         r.implicit_approval_mode AS repo_implicit_approval_mode,
         r.default_branch AS repo_default_branch
  FROM monitored_applications ma
  LEFT JOIN LATERAL (
    SELECT ar.github_repo_id
    FROM application_repositories ar
    WHERE ar.monitored_app_id = ma.id AND ar.status = 'active'
    ORDER BY ar.created_at DESC, ar.id DESC
    LIMIT 1
  ) active_repo ON true
  LEFT JOIN repositories r ON r.github_repo_id = active_repo.github_repo_id
`

function toMode(value: string | null | undefined): ImplicitApprovalMode {
  return value != null && isImplicitApprovalMode(value) ? value : 'off'
}

function toEffectiveSettings(row: EffectiveSettingsRow): EffectiveRepositorySettings {
  return resolveEffectiveSettings(
    row.repository_id == null
      ? null
      : {
          repositoryId: row.repository_id,
          auditStartYear: row.repo_audit_start_year,
          implicitApprovalMode: toMode(row.repo_implicit_approval_mode),
          defaultBranch: row.repo_default_branch,
        },
    {
      defaultBranch: row.app_default_branch,
    },
  )
}

const FALLBACK_SETTINGS: EffectiveRepositorySettings = {
  repositoryId: null,
  auditStartYear: null,
  implicitApprovalSettings: { mode: 'off' },
  defaultBranch: null,
}

export async function getEffectiveSettingsForApp(monitoredAppId: number): Promise<EffectiveRepositorySettings> {
  const { rows } = await pool.query<EffectiveSettingsRow>(`${EFFECTIVE_SETTINGS_SELECT} WHERE ma.id = $1`, [
    monitoredAppId,
  ])
  const row = rows[0]
  return row ? toEffectiveSettings(row) : FALLBACK_SETTINGS
}

export async function getEffectiveSettingsForApps(
  monitoredAppIds: number[],
): Promise<Map<number, EffectiveRepositorySettings>> {
  if (monitoredAppIds.length === 0) return new Map()

  const { rows } = await pool.query<EffectiveSettingsRow>(`${EFFECTIVE_SETTINGS_SELECT} WHERE ma.id = ANY($1::int[])`, [
    monitoredAppIds,
  ])
  return new Map(rows.map((row) => [row.monitored_app_id, toEffectiveSettings(row)]))
}

export async function getEffectiveAuditStartYear(monitoredAppId: number): Promise<number | null> {
  const settings = await getEffectiveSettingsForApp(monitoredAppId)
  return settings.auditStartYear
}

export async function getEffectiveImplicitApprovalSettings(
  monitoredAppId: number,
): Promise<EffectiveRepositorySettings['implicitApprovalSettings']> {
  const settings = await getEffectiveSettingsForApp(monitoredAppId)
  return settings.implicitApprovalSettings
}

export async function getEffectiveDefaultBranch(monitoredAppId: number): Promise<string | null> {
  const settings = await getEffectiveSettingsForApp(monitoredAppId)
  return settings.defaultBranch
}

async function getActiveRepoLink(
  queryable: Queryable,
  monitoredAppId: number,
): Promise<{ githubRepoId: string; githubOwner: string; githubRepoName: string } | null> {
  const { rows } = await queryable.query<{
    github_repo_id: string | null
    github_owner: string
    github_repo_name: string
  }>(
    `SELECT github_repo_id, github_owner, github_repo_name
     FROM application_repositories
     WHERE monitored_app_id = $1 AND status = 'active'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [monitoredAppId],
  )
  const row = rows[0]
  if (!row || row.github_repo_id === null) return null
  return { githubRepoId: row.github_repo_id, githubOwner: row.github_owner, githubRepoName: row.github_repo_name }
}

export async function getRepositoryIdForApp(monitoredAppId: number, client?: PoolClient): Promise<number | null> {
  const queryable: Queryable = client ?? pool
  const link = await getActiveRepoLink(queryable, monitoredAppId)
  if (!link) return null

  const { rows } = await queryable.query<{ id: number }>(`SELECT id FROM repositories WHERE github_repo_id = $1`, [
    link.githubRepoId,
  ])
  return rows[0]?.id ?? null
}

async function getAppIdsForGithubRepoId(queryable: Queryable, githubRepoId: string): Promise<number[]> {
  const { rows } = await queryable.query<{ id: number }>(
    `SELECT ma.id
     FROM (
       SELECT DISTINCT ON (monitored_app_id) monitored_app_id, github_repo_id
       FROM application_repositories
       WHERE status = 'active'
       ORDER BY monitored_app_id, created_at DESC, id DESC
     ) latest
     JOIN monitored_applications ma ON ma.id = latest.monitored_app_id
     WHERE ma.is_active = true AND latest.github_repo_id = $1`,
    [githubRepoId],
  )
  return rows.map((row) => row.id)
}

async function lockAppsAndRepoForGithubRepoId(
  client: PoolClient,
  githubRepoId: string,
  additionalAppId?: number,
): Promise<number[]> {
  let appIds = await getAppIdsForGithubRepoId(client, githubRepoId)

  for (let i = 0; i < 10; i++) {
    const probeAppIds = await getAppIdsForGithubRepoId(client, githubRepoId)
    const stableBeforeLocking = probeAppIds.length === appIds.length && probeAppIds.every((id) => appIds.includes(id))
    if (stableBeforeLocking) {
      const lockSet = Array.from(new Set(additionalAppId ? [...appIds, additionalAppId] : appIds)).sort((a, b) => a - b)
      for (const appId of lockSet) {
        await lockAppForWrite(client, appId)
      }
      await lockRepositoryForWrite(client, BigInt(githubRepoId))

      const freshAppIds = await getAppIdsForGithubRepoId(client, githubRepoId)
      const stableAfterLocking = freshAppIds.length === appIds.length && freshAppIds.every((id) => appIds.includes(id))
      if (stableAfterLocking) return freshAppIds

      throw new Error(
        `App set for github repo ${githubRepoId} changed after acquiring the repository lock; retry in a new transaction`,
      )
    }
    appIds = probeAppIds
  }

  throw new Error(`Could not reach a stable app set for github repo ${githubRepoId} after multiple attempts`)
}

async function upsertRepositoryRow(
  client: PoolClient,
  link: { githubRepoId: string; githubOwner: string; githubRepoName: string },
): Promise<Repository> {
  const { rows: existingRows } = await client.query<Repository>(
    `SELECT * FROM repositories WHERE github_repo_id = $1 FOR UPDATE`,
    [link.githubRepoId],
  )
  const existing = existingRows[0]
  if (existing) {
    if (existing.github_owner === link.githubOwner && existing.github_repo_name === link.githubRepoName) {
      return existing
    }
    await client.query(
      `INSERT INTO repository_name_history (repository_id, github_owner, github_repo_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (repository_id, github_owner, github_repo_name) DO UPDATE SET replaced_at = now()`,
      [existing.id, existing.github_owner, existing.github_repo_name],
    )
    const { rows } = await client.query<Repository>(
      `UPDATE repositories SET github_owner = $1, github_repo_name = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [link.githubOwner, link.githubRepoName, existing.id],
    )
    return rows[0]
  }

  const { rows } = await client.query<Repository>(
    `INSERT INTO repositories (github_repo_id, github_owner, github_repo_name, audit_start_year, implicit_approval_mode)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (github_repo_id) DO UPDATE SET
       github_owner = EXCLUDED.github_owner,
       github_repo_name = EXCLUDED.github_repo_name,
       updated_at = now()
     RETURNING *`,
    [link.githubRepoId, link.githubOwner, link.githubRepoName, null, 'off'],
  )
  return rows[0]
}

export async function recordRepoConfigAuditLog(
  params: {
    repositoryId: number
    settingKey: string
    oldValue: Record<string, unknown> | null
    newValue: Record<string, unknown>
    changedByNavIdent: string
    changedByName?: string
    changeReason?: string
  },
  client?: PoolClient,
): Promise<void> {
  const { repositoryId, settingKey, oldValue, newValue, changedByNavIdent, changedByName, changeReason } = params
  const queryable: Queryable = client ?? pool

  await queryable.query(
    `INSERT INTO repo_config_audit_log
     (repository_id, changed_by_nav_ident, changed_by_name, setting_key, old_value, new_value, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      repositoryId,
      changedByNavIdent,
      changedByName || null,
      settingKey,
      oldValue ? JSON.stringify(oldValue) : null,
      JSON.stringify(newValue),
      changeReason || null,
    ],
  )

  logger.info(
    `📝 Repo config audit log recorded for setting '${settingKey}' on repository ${repositoryId} by ${changedByNavIdent}`,
  )
}

export interface RepoConfigAuditLogEntry {
  id: number
  repository_id: number
  changed_by_nav_ident: string
  changed_by_name: string | null
  setting_key: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown>
  change_reason: string | null
  created_at: Date
}

export async function getRepoConfigAuditLog(
  repositoryId: number,
  options?: { limit?: number },
): Promise<RepoConfigAuditLogEntry[]> {
  const { rows } = await pool.query<RepoConfigAuditLogEntry>(
    `SELECT * FROM repo_config_audit_log WHERE repository_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [repositoryId, options?.limit ?? 20],
  )
  return rows
}

export interface RepositorySettingsPatch {
  auditStartYear?: number | null
  implicitApprovalMode?: ImplicitApprovalMode
  defaultBranch?: string | null
}

export type UpdateRepositorySettingsResult =
  | { ok: false; reason: 'app_not_found' | 'repo_not_found' | 'repo_not_linked' | 'unauthorized' }
  | {
      ok: true
      repositoryId: number
      changedKeys: string[]
      affectedApps: AffectedApp[]
      auditStartYearChange: AuditStartYearChangeResult | null
    }

export async function updateRepositorySettings(params: {
  monitoredAppId: number
  patch: RepositorySettingsPatch
  changedByNavIdent: string
  changedByName?: string
  changeReason?: string
}): Promise<UpdateRepositorySettingsResult> {
  const { monitoredAppId, patch, changedByNavIdent, changedByName, changeReason } = params

  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    const { rows: appRows } = await client.query<{ id: number }>(
      `SELECT id FROM monitored_applications WHERE id = $1`,
      [monitoredAppId],
    )
    if (appRows.length === 0) {
      return { ok: false, reason: 'app_not_found' }
    }

    await lockAppForWrite(client, monitoredAppId)

    const link = await getActiveRepoLink(client, monitoredAppId)
    if (!link) {
      return { ok: false, reason: 'repo_not_linked' }
    }

    const targetAppIds = await lockAppsAndRepoForGithubRepoId(client, link.githubRepoId, monitoredAppId)
    const repository = await upsertRepositoryRow(client, link)

    return applyRepositorySettingsPatch(client, {
      repository,
      targetAppIds,
      actingAppId: monitoredAppId,
      patch,
      changedByNavIdent,
      changedByName,
      changeReason,
    })
  })
}

export async function updateRepositorySettingsByRepositoryId(params: {
  repositoryId: number
  patch: RepositorySettingsPatch
  changedByNavIdent: string
  changedByName?: string
  changeReason?: string
  actor: UserIdentity
}): Promise<UpdateRepositorySettingsResult> {
  const { repositoryId, patch, changedByNavIdent, changedByName, changeReason, actor } = params

  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    const { rows: repoRows } = await client.query<Repository>(`SELECT * FROM repositories WHERE id = $1`, [
      repositoryId,
    ])
    const initialRepository = repoRows[0]
    if (!initialRepository) {
      return { ok: false, reason: 'repo_not_found' }
    }

    const targetAppIds = await lockAppsAndRepoForGithubRepoId(client, initialRepository.github_repo_id)
    if (targetAppIds.length === 0) {
      return { ok: false, reason: 'repo_not_linked' }
    }

    if (!(await canAccessAppsAdmin(actor, targetAppIds, client))) {
      return { ok: false, reason: 'unauthorized' }
    }

    const { rows: freshRepoRows } = await client.query<Repository>(`SELECT * FROM repositories WHERE id = $1`, [
      repositoryId,
    ])
    const repository = freshRepoRows[0]
    if (!repository) {
      return { ok: false, reason: 'repo_not_found' }
    }

    return applyRepositorySettingsPatch(client, {
      repository,
      targetAppIds,
      actingAppId: targetAppIds[0],
      patch,
      changedByNavIdent,
      changedByName,
      changeReason,
    })
  })
}

async function applyRepositorySettingsPatch(
  client: PoolClient,
  params: {
    repository: Repository
    targetAppIds: number[]
    actingAppId: number
    patch: RepositorySettingsPatch
    changedByNavIdent: string
    changedByName?: string
    changeReason?: string
  },
): Promise<UpdateRepositorySettingsResult> {
  const { repository, targetAppIds, actingAppId, patch, changedByNavIdent, changedByName, changeReason } = params

  const changedKeys: string[] = []
  let auditStartYearChange: AuditStartYearChangeResult | null = null

  if (patch.auditStartYear !== undefined && patch.auditStartYear !== repository.audit_start_year) {
    await client.query(`UPDATE repositories SET audit_start_year = $1, updated_at = now() WHERE id = $2`, [
      patch.auditStartYear,
      repository.id,
    ])
    await recordRepoConfigAuditLog(
      {
        repositoryId: repository.id,
        settingKey: REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
        oldValue: { audit_start_year: repository.audit_start_year },
        newValue: { audit_start_year: patch.auditStartYear },
        changedByNavIdent,
        changedByName,
        changeReason,
      },
      client,
    )
    auditStartYearChange = await applyAuditStartYearChangeForAppsLazy(
      client,
      actingAppId,
      targetAppIds,
      repository.audit_start_year,
      patch.auditStartYear,
      changedByNavIdent,
      { owner: repository.github_owner, repo: repository.github_repo_name, repositoryId: repository.id },
    )
    changedKeys.push(REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR)
  }

  if (patch.implicitApprovalMode !== undefined && patch.implicitApprovalMode !== repository.implicit_approval_mode) {
    await client.query(`UPDATE repositories SET implicit_approval_mode = $1, updated_at = now() WHERE id = $2`, [
      patch.implicitApprovalMode,
      repository.id,
    ])
    await recordRepoConfigAuditLog(
      {
        repositoryId: repository.id,
        settingKey: REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL,
        oldValue: { mode: repository.implicit_approval_mode },
        newValue: { mode: patch.implicitApprovalMode },
        changedByNavIdent,
        changedByName,
        changeReason,
      },
      client,
    )
    changedKeys.push(REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL)
  }

  if (patch.defaultBranch !== undefined && patch.defaultBranch !== repository.default_branch) {
    await client.query(`UPDATE repositories SET default_branch = $1, updated_at = now() WHERE id = $2`, [
      patch.defaultBranch,
      repository.id,
    ])
    await recordRepoConfigAuditLog(
      {
        repositoryId: repository.id,
        settingKey: REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
        oldValue: { default_branch: repository.default_branch },
        newValue: { default_branch: patch.defaultBranch },
        changedByNavIdent,
        changedByName,
        changeReason,
      },
      client,
    )
    await client.query(
      `UPDATE monitored_applications SET default_branch = $1, updated_at = now() WHERE id = ANY($2::int[])`,
      [patch.defaultBranch, targetAppIds],
    )
    changedKeys.push(REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH)
  }

  const { rows: affectedApps } = await client.query<AffectedApp>(
    `SELECT id, app_name, team_slug, environment_name
     FROM monitored_applications
     WHERE id = ANY($1::int[])
     ORDER BY environment_name, team_slug, app_name`,
    [targetAppIds],
  )

  return {
    ok: true,
    repositoryId: repository.id,
    changedKeys,
    affectedApps,
    auditStartYearChange,
  }
}

export async function syncRepositoryDefaultBranch(params: {
  monitoredAppId: number
  defaultBranch: string | null
  syncedAt: Date
}): Promise<boolean> {
  const { monitoredAppId, defaultBranch, syncedAt } = params

  return withTransaction(async (client) => {
    await lockAppForWrite(client, monitoredAppId)

    const link = await getActiveRepoLink(client, monitoredAppId)
    if (!link) return false

    const repository = await upsertRepositoryRow(client, link)

    const { rowCount } = await client.query(
      `UPDATE repositories
       SET default_branch = COALESCE($1, default_branch),
           default_branch_synced_at = $2,
           updated_at = now()
       WHERE id = $3`,
      [defaultBranch, syncedAt, repository.id],
    )
    return (rowCount ?? 0) > 0
  })
}
