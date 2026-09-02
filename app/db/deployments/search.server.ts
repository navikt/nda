import { getAllMonorepoGroups } from '~/db/monorepo.server'
import { pool } from '../connection.server'

export interface SearchResult {
  type: 'deployment' | 'user' | 'team' | 'app' | 'group' | 'dev_team'
  id?: number
  url: string
  title: string
  subtitle?: string
}

export async function searchDeployments(query: string, limit = 10): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return results

  if (/^DI_/i.test(trimmedQuery)) {
    const naisResult = await pool.query(
      `SELECT d.id, d.nais_deployment_id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.nais_deployment_id ILIKE $1
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [`${trimmedQuery}%`, limit],
    )
    for (const row of naisResult.rows) {
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `Deployment #${row.id}`,
        subtitle: `${row.app_name} • ${row.nais_deployment_id.substring(0, 20)}...`,
      })
    }
    return results
  }

  if (/^\d+$/.test(trimmedQuery)) {
    const deploymentId = parseInt(trimmedQuery, 10)
    const result = await pool.query(
      `SELECT d.id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.id = $1`,
      [deploymentId],
    )
    if (result.rows.length > 0) {
      const row = result.rows[0]
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `Deployment #${row.id}`,
        subtitle: `${row.app_name} • ${row.commit_sha?.substring(0, 7) || 'ukjent SHA'}`,
      })
    }
    return results
  }

  const looksLikeSha = /^[0-9a-f]{3,40}$/i.test(trimmedQuery)

  if (looksLikeSha) {
    const shaResult = await pool.query(
      `SELECT d.id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.commit_sha ILIKE $1
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [`${trimmedQuery}%`, limit],
    )
    for (const row of shaResult.rows) {
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `${row.commit_sha?.substring(0, 7)}`,
        subtitle: `${row.app_name} • ${row.deployer_username || 'ukjent'}`,
      })
    }
    if (results.length > 0) {
      return results
    }
  }

  const [userResult, teamResult, appResult, monorepoGroups, devTeamResult] = await Promise.all([
    pool.query(
      `SELECT DISTINCT d.deployer_username, 
              u.display_name, uga.nav_ident, u.slack_member_id,
              COUNT(*) as deployment_count
       FROM deployments d
       LEFT JOIN user_github_accounts uga ON LOWER(d.deployer_username) = uga.github_username AND uga.deleted_at IS NULL
       LEFT JOIN users u ON uga.nav_ident = u.nav_ident AND u.deleted_at IS NULL
       WHERE d.deployer_username ILIKE $1
          OR u.display_name ILIKE $1
          OR uga.nav_ident ILIKE $1
          OR u.slack_member_id ILIKE $1
       GROUP BY d.deployer_username, u.display_name, uga.nav_ident, u.slack_member_id
       ORDER BY deployment_count DESC
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
    pool.query(
      `SELECT DISTINCT ma.team_slug, COUNT(DISTINCT ma.app_name) AS app_count
       FROM monitored_applications ma
       WHERE ma.is_active = true AND ma.team_slug ILIKE $1
       GROUP BY ma.team_slug
       ORDER BY ma.team_slug
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
    pool.query(
      `SELECT DISTINCT ma.app_name, ma.team_slug, ma.environment_name
       FROM monitored_applications ma
       WHERE ma.is_active = true AND ma.app_name ILIKE $1
       ORDER BY ma.app_name, ma.environment_name
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
    getAllMonorepoGroups(),
    pool.query(
      `SELECT dt.id, dt.name, dt.slug, s.slug AS section_slug,
              COUNT(DISTINCT dta.monitored_app_id)::int AS app_count
       FROM dev_teams dt
       JOIN sections s ON s.id = dt.section_id
       LEFT JOIN dev_team_applications dta ON dta.dev_team_id = dt.id AND dta.deleted_at IS NULL
       WHERE dt.is_active = true AND (dt.name ILIKE $1 OR dt.slug ILIKE $1)
       GROUP BY dt.id, dt.name, dt.slug, s.slug
       ORDER BY dt.name
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
  ])

  const matchingGroups = monorepoGroups
    .filter((g) => `${g.github_owner}/${g.github_repo_name}`.toLowerCase().includes(trimmedQuery.toLowerCase()))
    .slice(0, limit)

  for (const group of matchingGroups) {
    const appNames = group.apps.map((a) => a.app_name).sort()
    const maxShown = 3
    const displayNames =
      appNames.length > maxShown ? [...appNames.slice(0, maxShown), `+${appNames.length - maxShown}`] : appNames
    const firstApp = [...group.apps].sort((a, b) => a.app_name.localeCompare(b.app_name))[0]
    results.push({
      type: 'group',
      url: firstApp
        ? `/team/${firstApp.team_slug}/env/${firstApp.environment_name}/app/${firstApp.app_name}/deployments`
        : '/search',
      title: `${group.github_owner}/${group.github_repo_name}`,
      subtitle: displayNames.length > 0 ? `Monorepo: ${displayNames.join(', ')}` : 'Monorepo (tom)',
    })
  }

  for (const row of devTeamResult.rows) {
    results.push({
      type: 'dev_team',
      id: row.id,
      url: `/sections/${row.section_slug}/teams/${row.slug}`,
      title: row.name,
      subtitle: `Utviklerteam${row.app_count > 0 ? ` · ${row.app_count} app${row.app_count === 1 ? '' : 'er'}` : ''}`,
    })
  }

  for (const row of teamResult.rows) {
    results.push({
      type: 'team',
      url: `/team/${row.team_slug}`,
      title: row.team_slug,
      subtitle: `${row.app_count} applikasjon${row.app_count === 1 ? '' : 'er'}`,
    })
  }

  const seenApps = new Set<string>()
  for (const row of appResult.rows) {
    const key = `${row.team_slug}/${row.app_name}`
    if (seenApps.has(key)) continue
    seenApps.add(key)
    results.push({
      type: 'app',
      url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}`,
      title: row.app_name,
      subtitle: row.team_slug,
    })
  }
  for (const row of userResult.rows) {
    let matchInfo = ''
    const queryLower = trimmedQuery.toLowerCase()
    if (row.display_name?.toLowerCase().includes(queryLower)) {
      matchInfo = row.display_name
    } else if (row.nav_ident?.toLowerCase().includes(queryLower)) {
      matchInfo = `NAV-ident: ${row.nav_ident}`
    } else if (row.slack_member_id?.toLowerCase().includes(queryLower)) {
      matchInfo = `Slack: ${row.slack_member_id}`
    }

    results.push({
      type: 'user',
      url: `/users/${row.deployer_username}`,
      title: row.display_name || row.deployer_username,
      subtitle: matchInfo
        ? `${row.deployer_username} • ${matchInfo} • ${row.deployment_count} deployment(s)`
        : `${row.deployer_username} • ${row.deployment_count} deployment(s)`,
    })
  }

  return results
}
