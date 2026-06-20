import { pool } from './connection.server'

interface ApplicationRepository {
  id: number
  monitored_app_id: number
  github_owner: string
  github_repo_name: string
  status: 'active' | 'historical' | 'pending_approval'
  redirects_to_owner: string | null
  redirects_to_repo: string | null
  notes: string | null
  approved_at: Date | null
  approved_by: string | null
  created_at: Date
}

export async function getRepositoriesByAppId(appId: number): Promise<ApplicationRepository[]> {
  const result = await pool.query(
    `SELECT * FROM application_repositories 
     WHERE monitored_app_id = $1 
     ORDER BY 
       CASE status 
         WHEN 'active' THEN 1 
         WHEN 'historical' THEN 2 
         WHEN 'pending_approval' THEN 3 
       END,
       created_at DESC`,
    [appId],
  )
  return result.rows
}

export async function findRepositoryForApp(
  appId: number,
  owner: string,
  repoName: string,
): Promise<{
  repository: ApplicationRepository | null
  effectiveOwner: string
  effectiveRepo: string
  isRedirected: boolean
}> {
  const result = await pool.query(
    `SELECT * FROM application_repositories 
     WHERE monitored_app_id = $1 
       AND github_owner = $2 
       AND github_repo_name = $3`,
    [appId, owner, repoName],
  )

  if (result.rows.length === 0) {
    return {
      repository: null,
      effectiveOwner: owner,
      effectiveRepo: repoName,
      isRedirected: false,
    }
  }

  const repo = result.rows[0]

  if (repo.redirects_to_owner && repo.redirects_to_repo) {
    return {
      repository: repo,
      effectiveOwner: repo.redirects_to_owner,
      effectiveRepo: repo.redirects_to_repo,
      isRedirected: true,
    }
  }

  return {
    repository: repo,
    effectiveOwner: owner,
    effectiveRepo: repoName,
    isRedirected: false,
  }
}

export async function upsertApplicationRepository(data: {
  monitoredAppId: number
  githubOwner: string
  githubRepoName: string
  status: 'active' | 'historical' | 'pending_approval'
  redirectsToOwner?: string | null
  redirectsToRepo?: string | null
  notes?: string | null
  approvedBy?: string | null
}): Promise<ApplicationRepository> {
  const approvedAt = data.status !== 'pending_approval' ? new Date() : null

  const result = await pool.query(
    `INSERT INTO application_repositories (
      monitored_app_id, github_owner, github_repo_name, status,
      redirects_to_owner, redirects_to_repo, notes, approved_at, approved_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (monitored_app_id, github_owner, github_repo_name)
    DO UPDATE SET
      status = EXCLUDED.status,
      redirects_to_owner = EXCLUDED.redirects_to_owner,
      redirects_to_repo = EXCLUDED.redirects_to_repo,
      notes = EXCLUDED.notes,
      approved_at = EXCLUDED.approved_at,
      approved_by = EXCLUDED.approved_by
    RETURNING *`,
    [
      data.monitoredAppId,
      data.githubOwner,
      data.githubRepoName,
      data.status,
      data.redirectsToOwner || null,
      data.redirectsToRepo || null,
      data.notes || null,
      approvedAt,
      data.approvedBy || null,
    ],
  )
  return result.rows[0]
}

export async function approveRepository(
  repoId: number,
  approvedBy: string,
  setAsActive: boolean = false,
): Promise<ApplicationRepository> {
  const status = setAsActive ? 'active' : 'historical'

  if (setAsActive) {
    const repo = await pool.query('SELECT monitored_app_id FROM application_repositories WHERE id = $1', [repoId])

    if (repo.rows.length > 0) {
      await pool.query(
        `UPDATE application_repositories 
         SET status = 'historical' 
         WHERE monitored_app_id = $1 
           AND status = 'active' 
           AND id != $2`,
        [repo.rows[0].monitored_app_id, repoId],
      )
    }
  }

  const result = await pool.query(
    `UPDATE application_repositories 
     SET status = $1, approved_at = NOW(), approved_by = $2
     WHERE id = $3
     RETURNING *`,
    [status, approvedBy, repoId],
  )

  if (result.rows.length === 0) {
    throw new Error(`Repository with id ${repoId} not found`)
  }

  return result.rows[0]
}

export async function rejectRepository(repoId: number): Promise<void> {
  await pool.query(`DELETE FROM application_repositories WHERE id = $1 AND status = 'pending_approval'`, [repoId])
}

export async function setRepositoryAsActive(repoId: number): Promise<ApplicationRepository> {
  const repo = await pool.query('SELECT monitored_app_id FROM application_repositories WHERE id = $1', [repoId])

  if (repo.rows.length === 0) {
    throw new Error(`Repository with id ${repoId} not found`)
  }

  await pool.query(
    `UPDATE application_repositories 
     SET status = 'historical' 
     WHERE monitored_app_id = $1 AND id != $2 AND status = 'active'`,
    [repo.rows[0].monitored_app_id, repoId],
  )

  const result = await pool.query(
    `UPDATE application_repositories 
     SET status = 'active' 
     WHERE id = $1 
     RETURNING *`,
    [repoId],
  )

  return result.rows[0]
}

export async function getAllActiveRepositories(): Promise<Map<number, string>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (monitored_app_id) monitored_app_id, github_owner, github_repo_name
     FROM application_repositories 
     WHERE status = 'active'
     ORDER BY monitored_app_id, created_at DESC, id DESC`,
  )

  const map = new Map<number, string>()
  for (const row of result.rows) {
    map.set(row.monitored_app_id, `${row.github_owner}/${row.github_repo_name}`)
  }
  return map
}
