import { REVERIFIABLE_STATUSES } from '~/lib/four-eyes-status'
import { pool } from './connection.server'

export interface MonorepoAppEntry {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  default_branch: string | null
  audit_start_year: number | null
}

export interface MonorepoGroup {
  github_owner: string
  github_repo_name: string
  apps: MonorepoAppEntry[]
  base_branch_mismatch: boolean
  audit_year_mismatch: boolean
}

export interface MonorepoSiblingInfo {
  github_owner: string
  github_repo_name: string
  siblings: MonorepoAppEntry[]
  base_branch_mismatch: boolean
  audit_year_mismatch: boolean
}

interface MonorepoRow extends MonorepoAppEntry {
  github_owner: string
  github_repo_name: string
}

const ACTIVE_REPO_PER_APP = `
  SELECT DISTINCT ON (monitored_app_id) monitored_app_id, github_owner, github_repo_name
  FROM application_repositories
  WHERE status = 'active'
  ORDER BY monitored_app_id, created_at DESC, id DESC
`

const MONOREPO_ROWS_SELECT = `
  SELECT ar.github_owner, ar.github_repo_name,
         ma.id, ma.app_name, ma.team_slug, ma.environment_name,
         ma.default_branch, ma.audit_start_year
  FROM (${ACTIVE_REPO_PER_APP}) ar
  JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
  WHERE ma.is_active = true
`

function hasMismatch(values: (string | number | null)[]): boolean {
  return new Set(values).size > 1
}

function toAppEntry({ github_owner: _owner, github_repo_name: _repo, ...app }: MonorepoRow): MonorepoAppEntry {
  return app
}

export async function getAllMonorepoGroups(): Promise<MonorepoGroup[]> {
  const result = await pool.query<MonorepoRow>(
    `${MONOREPO_ROWS_SELECT}
       AND (ar.github_owner, ar.github_repo_name) IN (
         SELECT ar2.github_owner, ar2.github_repo_name
         FROM (${ACTIVE_REPO_PER_APP}) ar2
         JOIN monitored_applications ma2 ON ma2.id = ar2.monitored_app_id
         WHERE ma2.is_active = true
         GROUP BY ar2.github_owner, ar2.github_repo_name
         HAVING COUNT(DISTINCT ar2.monitored_app_id) > 1
       )
     ORDER BY ar.github_owner, ar.github_repo_name, ma.environment_name, ma.team_slug, ma.app_name`,
  )

  const groups = new Map<string, MonorepoRow[]>()
  for (const row of result.rows) {
    const key = `${row.github_owner}/${row.github_repo_name}`
    const existing = groups.get(key)
    if (existing) {
      existing.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  return [...groups.values()].map((rows) => {
    const appsById = new Map<number, MonorepoAppEntry>()
    for (const row of rows) {
      appsById.set(row.id, toAppEntry(row))
    }
    const apps = [...appsById.values()]
    return {
      github_owner: rows[0].github_owner,
      github_repo_name: rows[0].github_repo_name,
      apps,
      base_branch_mismatch: hasMismatch(apps.map((a) => a.default_branch)),
      audit_year_mismatch: hasMismatch(apps.map((a) => a.audit_start_year)),
    }
  })
}

export async function getMonorepoSiblings(monitoredAppId: number): Promise<MonorepoSiblingInfo | null> {
  const ownRepo = await pool.query<{ github_owner: string; github_repo_name: string }>(
    `SELECT ar.github_owner, ar.github_repo_name
     FROM application_repositories ar
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE ar.monitored_app_id = $1 AND ar.status = 'active' AND ma.is_active = true
     ORDER BY ar.created_at DESC, ar.id DESC
     LIMIT 1`,
    [monitoredAppId],
  )
  if (ownRepo.rows.length === 0) return null
  const { github_owner: ownerName, github_repo_name: repoName } = ownRepo.rows[0]

  const result = await pool.query<MonorepoRow>(
    `${MONOREPO_ROWS_SELECT}
       AND ar.github_owner = $1 AND ar.github_repo_name = $2
     ORDER BY ma.environment_name, ma.team_slug, ma.app_name`,
    [ownerName, repoName],
  )

  const appsById = new Map<number, MonorepoAppEntry>()
  for (const row of result.rows) {
    appsById.set(row.id, toAppEntry(row))
  }

  const siblings = [...appsById.values()].filter((a) => a.id !== monitoredAppId)
  if (siblings.length === 0) return null

  const allApps = [...appsById.values()]

  return {
    github_owner: ownerName,
    github_repo_name: repoName,
    siblings,
    base_branch_mismatch: hasMismatch(allApps.map((a) => a.default_branch)),
    audit_year_mismatch: hasMismatch(allApps.map((a) => a.audit_start_year)),
  }
}

const PROPAGATABLE_STATUSES = new Set([
  'approved',
  'approved_pr_with_unreviewed',
  'implicitly_approved',
  'no_changes',
  'manually_approved',
])

const PROPAGATION_TARGET_STATUSES = [...REVERIFIABLE_STATUSES, 'error']

export async function propagateVerificationToSiblings(
  deploymentId: number,
  status: string,
  commitSha: string,
  monitoredAppId: number,
  hasFourEyes = true,
): Promise<number> {
  if (!hasFourEyes || !PROPAGATABLE_STATUSES.has(status)) return 0

  const result = await pool.query(
    `UPDATE deployments
     SET four_eyes_status = $1
     WHERE commit_sha = $2
       AND four_eyes_status = ANY($3::text[])
       AND id != $4
       AND monitored_app_id IN (
         SELECT ar.monitored_app_id FROM application_repositories ar
         JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
         WHERE ar.status = 'active'
           AND ma.is_active = true
           AND ar.github_repo_id IS NOT NULL
           AND ar.github_repo_id IN (
             SELECT ar2.github_repo_id FROM application_repositories ar2
             WHERE ar2.monitored_app_id = $5 AND ar2.status = 'active' AND ar2.github_repo_id IS NOT NULL
           )
           AND ar.monitored_app_id != $5
       )`,
    [status, commitSha, PROPAGATION_TARGET_STATUSES, deploymentId, monitoredAppId],
  )

  return result.rowCount ?? 0
}
