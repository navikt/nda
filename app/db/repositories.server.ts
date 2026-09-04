import type { PoolClient } from 'pg'
import { logger } from '~/lib/logger.server'
import { type EffectiveRepositorySettings, resolveEffectiveSettings } from '~/lib/repository-settings'
import { type ImplicitApprovalMode, isImplicitApprovalMode } from '~/lib/verification/types'
import type { AuditStartYearChangeResult } from './audit-start-year-baseline.server'
import { pool, withTransaction } from './connection.server'

interface Repository {
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

export const REPOSITORY_SETTING_KEYS = {
  AUDIT_START_YEAR: 'audit_start_year',
  IMPLICIT_APPROVAL: 'implicit_approval',
  DEFAULT_BRANCH: 'default_branch',
} as const

type Queryable = Pick<PoolClient, 'query'>

async function applyAuditStartYearChangeForAppsLazy(
  client: PoolClient,
  appId: number,
  targetAppIds: number[],
  newAuditStartYear: number | null,
  adminNavIdent: string,
): Promise<AuditStartYearChangeResult> {
  const { applyAuditStartYearChangeForApps } = await import('./audit-start-year-baseline.server')
  return applyAuditStartYearChangeForApps(client, appId, targetAppIds, newAuditStartYear, adminNavIdent)
}

interface EffectiveSettingsRow {
  monitored_app_id: number
  app_audit_start_year: number | null
  app_default_branch: string | null
  app_implicit_approval_mode: string | null
  repository_id: number | null
  repo_audit_start_year: number | null
  repo_implicit_approval_mode: string | null
  repo_default_branch: string | null
}

const EFFECTIVE_SETTINGS_SELECT = `
  SELECT ma.id AS monitored_app_id,
         ma.audit_start_year AS app_audit_start_year,
         ma.default_branch AS app_default_branch,
         s.setting_value ->> 'mode' AS app_implicit_approval_mode,
         r.id AS repository_id,
         r.audit_start_year AS repo_audit_start_year,
         r.implicit_approval_mode AS repo_implicit_approval_mode,
         r.default_branch AS repo_default_branch
  FROM monitored_applications ma
  LEFT JOIN app_settings s ON s.monitored_app_id = ma.id AND s.setting_key = 'implicit_approval'
  LEFT JOIN LATERAL (
    SELECT ar.github_repo_id
    FROM application_repositories ar
    WHERE ar.monitored_app_id = ma.id AND ar.status = 'active' AND ar.github_repo_id IS NOT NULL
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
      auditStartYear: row.app_audit_start_year,
      implicitApprovalMode: toMode(row.app_implicit_approval_mode),
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
    github_repo_id: string
    github_owner: string
    github_repo_name: string
  }>(
    `SELECT github_repo_id, github_owner, github_repo_name
     FROM application_repositories
     WHERE monitored_app_id = $1 AND status = 'active' AND github_repo_id IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [monitoredAppId],
  )
  const row = rows[0]
  if (!row) return null
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
    `SELECT DISTINCT ma.id
     FROM application_repositories ar
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE ar.status = 'active' AND ma.is_active = true AND ar.github_repo_id = $1`,
    [githubRepoId],
  )
  return rows.map((row) => row.id)
}

export async function getAffectedAppsForRepo(monitoredAppId: number): Promise<AffectedApp[]> {
  const link = await getActiveRepoLink(pool, monitoredAppId)
  if (!link) return []

  const { rows } = await pool.query<AffectedApp>(
    `SELECT DISTINCT ma.id, ma.app_name, ma.team_slug, ma.environment_name
     FROM application_repositories ar
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE ar.status = 'active' AND ar.github_repo_id = $1 AND (ma.is_active = true OR ma.id = $2)
     ORDER BY ma.environment_name, ma.team_slug, ma.app_name`,
    [link.githubRepoId, monitoredAppId],
  )
  return rows
}

const MERGED_GROUP_SETTINGS_SQL = `
  SELECT MIN(ma.audit_start_year) AS audit_start_year,
         MIN(
           CASE COALESCE(s.setting_value ->> 'mode', 'off')
             WHEN 'dependabot_only' THEN 2
             WHEN 'all' THEN 3
             ELSE 1
           END
         ) AS strictness
  FROM application_repositories ar
  JOIN monitored_applications ma ON ma.id = ar.monitored_app_id AND ma.is_active = true
  LEFT JOIN app_settings s ON s.monitored_app_id = ma.id AND s.setting_key = 'implicit_approval'
  WHERE ar.status = 'active' AND ar.github_repo_id = $1
`

const STRICTNESS_TO_MODE: Record<number, ImplicitApprovalMode> = {
  1: 'off',
  2: 'dependabot_only',
  3: 'all',
}

async function upsertRepositoryRow(
  client: PoolClient,
  link: { githubRepoId: string; githubOwner: string; githubRepoName: string },
): Promise<Repository> {
  const { rows: existingRows } = await client.query<Repository>(
    `SELECT * FROM repositories WHERE github_repo_id = $1`,
    [link.githubRepoId],
  )
  const existing = existingRows[0]
  if (existing) {
    if (existing.github_owner === link.githubOwner && existing.github_repo_name === link.githubRepoName) {
      return existing
    }
    const { rows } = await client.query<Repository>(
      `UPDATE repositories SET github_owner = $1, github_repo_name = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [link.githubOwner, link.githubRepoName, existing.id],
    )
    return rows[0]
  }

  const { rows: mergedRows } = await client.query<{ audit_start_year: number | null; strictness: number | null }>(
    MERGED_GROUP_SETTINGS_SQL,
    [link.githubRepoId],
  )
  const merged = mergedRows[0]
  const seedAuditStartYear = merged?.audit_start_year ?? null
  const seedMode = STRICTNESS_TO_MODE[merged?.strictness ?? 1] ?? 'off'

  const { rows } = await client.query<Repository>(
    `INSERT INTO repositories (github_repo_id, github_owner, github_repo_name, audit_start_year, implicit_approval_mode)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (github_repo_id) DO UPDATE SET
       github_owner = EXCLUDED.github_owner,
       github_repo_name = EXCLUDED.github_repo_name,
       updated_at = now()
     RETURNING *`,
    [link.githubRepoId, link.githubOwner, link.githubRepoName, seedAuditStartYear, seedMode],
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

export interface RepositorySettingsPatch {
  auditStartYear?: number | null
  implicitApprovalMode?: ImplicitApprovalMode
  defaultBranch?: string | null
}

export type UpdateRepositorySettingsResult =
  | { ok: false; reason: 'app_not_found' | 'repo_not_linked' }
  | {
      ok: true
      repositoryId: number
      changedKeys: string[]
      affectedApps: AffectedApp[]
      auditStartYearChange: AuditStartYearChangeResult | null
    }

async function mirrorImplicitApprovalToApps(
  client: PoolClient,
  appIds: number[],
  mode: ImplicitApprovalMode,
): Promise<void> {
  await client.query(
    `INSERT INTO app_settings (monitored_app_id, setting_key, setting_value, updated_at)
     SELECT id, 'implicit_approval', $2::jsonb, CURRENT_TIMESTAMP FROM UNNEST($1::int[]) AS ids(id)
     ON CONFLICT (monitored_app_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
    [appIds, JSON.stringify({ mode })],
  )
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
    const { rows: appRows } = await client.query<{ id: number }>(
      `SELECT id FROM monitored_applications WHERE id = $1`,
      [monitoredAppId],
    )
    if (appRows.length === 0) {
      return { ok: false, reason: 'app_not_found' }
    }

    const link = await getActiveRepoLink(client, monitoredAppId)
    if (!link) {
      return { ok: false, reason: 'repo_not_linked' }
    }

    const repository = await upsertRepositoryRow(client, link)
    const appIds = await getAppIdsForGithubRepoId(client, link.githubRepoId)
    const targetAppIds = appIds.includes(monitoredAppId) ? appIds : [...appIds, monitoredAppId]

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
        monitoredAppId,
        targetAppIds,
        patch.auditStartYear,
        changedByNavIdent,
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
      await mirrorImplicitApprovalToApps(client, targetAppIds, patch.implicitApprovalMode)
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
  })
}

export async function syncRepositoryDefaultBranch(params: {
  monitoredAppId: number
  defaultBranch: string | null
  syncedAt: Date
}): Promise<boolean> {
  const { monitoredAppId, defaultBranch, syncedAt } = params

  return withTransaction(async (client) => {
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
