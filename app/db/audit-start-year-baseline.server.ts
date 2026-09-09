import type { PoolClient } from 'pg'
import { computeBaselineRecomputePlan } from '~/lib/audit-start-year-baseline'
import { type FourEyesStatus, NON_DIFFABLE_STATUSES_SQL, UNAUTHORIZED_STATUSES_SQL } from '~/lib/four-eyes-status'

const ELIGIBLE_DEPLOYMENT_SQL = `
  d.commit_sha IS NOT NULL
  AND d.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL})
  AND d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
  AND d.commit_sha !~ '^refs/'
`

interface MarkerRow {
  id: number
  four_eyes_status: FourEyesStatus
  monitored_app_id: number
}

export interface RepoScope {
  owner: string
  repo: string
  repositoryId?: number
}

type RepoScopeResolution = { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'scoped'; scope: RepoScope[] }

async function resolveRepoScope(client: PoolClient, appIds: number[]): Promise<RepoScopeResolution> {
  const { rows } = await client.query<{ github_owner: string; github_repo_name: string; repository_id: number | null }>(
    `SELECT DISTINCT ar.github_owner, ar.github_repo_name, r.id AS repository_id
     FROM application_repositories ar
     LEFT JOIN repositories r ON r.github_repo_id = ar.github_repo_id
     WHERE ar.monitored_app_id = ANY($1) AND ar.status = 'active'`,
    [appIds],
  )
  if (rows.length === 0) return { kind: 'none' }
  if (rows.length > 1) return { kind: 'ambiguous' }
  const row = rows[0]
  if (!row) return { kind: 'none' }
  return {
    kind: 'scoped',
    scope: [{ owner: row.github_owner, repo: row.github_repo_name, repositoryId: row.repository_id ?? undefined }],
  }
}

async function withHistoricalNames(client: PoolClient, scopes: RepoScope[]): Promise<RepoScope[]> {
  const expanded: RepoScope[] = [...scopes]
  for (const scope of scopes) {
    if (scope.repositoryId === undefined) continue
    const { rows } = await client.query<{ github_owner: string; github_repo_name: string }>(
      `SELECT rnh.github_owner, rnh.github_repo_name
       FROM repository_name_history rnh
       WHERE rnh.repository_id = $1`,
      [scope.repositoryId],
    )
    for (const row of rows) {
      const { rows: claimedByOther } = await client.query<{ id: number }>(
        `SELECT id FROM repositories
         WHERE github_owner = $1 AND github_repo_name = $2 AND id != $3`,
        [row.github_owner, row.github_repo_name, scope.repositoryId],
      )
      if (claimedByOther.length > 0) continue
      expanded.push({ owner: row.github_owner, repo: row.github_repo_name, repositoryId: scope.repositoryId })
    }
  }
  return expanded
}

async function insertStatusHistory(
  client: PoolClient,
  deploymentId: number,
  fromStatus: FourEyesStatus,
  toStatus: FourEyesStatus,
  changedBy: string,
  previousAuditStartYear: number | null,
  newAuditStartYear: number | null,
): Promise<void> {
  await client.query(
    `INSERT INTO deployment_status_history (deployment_id, from_status, to_status, changed_by, change_source, details)
     VALUES ($1, $2, $3, $4, 'audit_start_year_change', $5)`,
    [
      deploymentId,
      fromStatus,
      toStatus,
      changedBy,
      JSON.stringify({
        reason: 'Nytt startår for revisjon',
        previous_audit_start_year: previousAuditStartYear,
        audit_start_year: newAuditStartYear,
      }),
    ],
  )
}

export interface AuditStartYearChangeResult {
  updatedAppIds: number[]
  promotedDeploymentId: number | null
  demotedDeploymentIds: number[]
  recomputeLimitedToActingApp: boolean
  recomputeSkippedDueToAmbiguousRepoScope: boolean
}

function appendRepoScope(params: unknown[], repoScopes: RepoScope[] | null): string {
  if (!repoScopes || repoScopes.length === 0) return ''
  const pairs = repoScopes.map((scope) => {
    const ownerIdx = params.length + 1
    const repoIdx = params.length + 2
    params.push(scope.owner, scope.repo)
    return `(d.detected_github_owner = $${ownerIdx} AND d.detected_github_repo_name = $${repoIdx})`
  })
  return ` AND (${pairs.join(' OR ')})`
}

function appendMarkerRepoScope(params: unknown[], repoScopes: RepoScope[] | null): string {
  if (!repoScopes || repoScopes.length === 0) return ''
  const pairs = repoScopes.map((scope) => {
    const ownerIdx = params.length + 1
    const repoIdx = params.length + 2
    params.push(scope.owner, scope.repo)
    return `(d.detected_github_owner = $${ownerIdx} AND d.detected_github_repo_name = $${repoIdx})`
  })
  return ` AND (
    ${pairs.join(' OR ')}
    OR (d.detected_github_owner IS NULL AND d.detected_github_repo_name IS NULL)
  )`
}

async function recomputeBaseline(
  client: PoolClient,
  appIds: number[],
  repoScope: RepoScope[] | null,
  newAuditStartYear: number | null,
  adminNavIdent: string,
  previousAuditStartYearByAppId: Map<number, number | null>,
): Promise<{ promotedDeploymentId: number | null; demotedDeploymentIds: number[] }> {
  const markerParams: unknown[] = [appIds]
  const markerRepoScopeSql = appendMarkerRepoScope(markerParams, repoScope)

  const { rows: markerRows } = await client.query<MarkerRow>(
    `SELECT d.id, d.four_eyes_status, d.monitored_app_id
     FROM deployments d
     WHERE d.monitored_app_id = ANY($1)
       AND d.four_eyes_status IN ('pending_baseline', 'baseline')
       ${markerRepoScopeSql}
     ORDER BY d.created_at ASC, d.id ASC`,
    markerParams,
  )

  const newFirstParams: unknown[] = [appIds]
  const newFirstRepoScopeSql = appendRepoScope(newFirstParams, repoScope)
  let newFirstQuery = `
    SELECT d.id, d.four_eyes_status, d.monitored_app_id
    FROM deployments d
    WHERE d.monitored_app_id = ANY($1)
      AND ${ELIGIBLE_DEPLOYMENT_SQL}
      ${newFirstRepoScopeSql}
  `
  if (newAuditStartYear) {
    newFirstQuery += ` AND d.created_at >= make_date($${newFirstParams.length + 1}, 1, 1)`
    newFirstParams.push(newAuditStartYear)
  }
  newFirstQuery += ` ORDER BY d.created_at ASC, d.id ASC LIMIT 1`

  const { rows: firstRows } = await client.query<MarkerRow>(newFirstQuery, newFirstParams)
  const newFirst = firstRows[0] ?? null

  const plan = computeBaselineRecomputePlan(markerRows, newFirst)

  if (plan.promote) {
    const { rowCount } = await client.query(
      `UPDATE deployments SET four_eyes_status = 'pending_baseline' WHERE id = $1 AND four_eyes_status = $2`,
      [plan.promote.id, plan.promote.fromStatus],
    )
    if (rowCount === 0) {
      throw new Error(
        `Deployment ${plan.promote.id} four_eyes_status changed concurrently (expected ${plan.promote.fromStatus}); aborting baseline recompute`,
      )
    }
    await insertStatusHistory(
      client,
      plan.promote.id,
      plan.promote.fromStatus,
      'pending_baseline',
      adminNavIdent,
      previousAuditStartYearByAppId.get(newFirst?.monitored_app_id ?? -1) ?? null,
      newAuditStartYear,
    )
  }

  const markerByDeploymentId = new Map(markerRows.map((row) => [row.id, row]))
  for (const demote of plan.demotes) {
    const { rowCount } = await client.query(
      `UPDATE deployments SET four_eyes_status = $1 WHERE id = $2 AND four_eyes_status = $3`,
      [demote.toStatus, demote.id, demote.fromStatus],
    )
    if (rowCount === 0) {
      throw new Error(
        `Deployment ${demote.id} four_eyes_status changed concurrently (expected ${demote.fromStatus}); aborting baseline recompute`,
      )
    }
    const demotedMarker = markerByDeploymentId.get(demote.id)
    await insertStatusHistory(
      client,
      demote.id,
      demote.fromStatus,
      demote.toStatus,
      adminNavIdent,
      previousAuditStartYearByAppId.get(demotedMarker?.monitored_app_id ?? -1) ?? null,
      newAuditStartYear,
    )
  }

  return {
    promotedDeploymentId: plan.promote?.id ?? null,
    demotedDeploymentIds: plan.demotes.map((demote) => demote.id),
  }
}

export async function applyAuditStartYearChangeForApps(
  client: PoolClient,
  appId: number,
  targetAppIds: number[],
  previousAuditStartYear: number | null,
  newAuditStartYear: number | null,
  adminNavIdent: string,
  explicitRepoScope?: RepoScope,
): Promise<AuditStartYearChangeResult> {
  const previousAuditStartYearByAppId = new Map<number, number | null>(
    targetAppIds.map((id) => [id, previousAuditStartYear]),
  )

  const repoScopeResolution: RepoScopeResolution = explicitRepoScope
    ? { kind: 'scoped', scope: [explicitRepoScope] }
    : await resolveRepoScope(client, targetAppIds)

  if (repoScopeResolution.kind === 'ambiguous') {
    return {
      updatedAppIds: targetAppIds,
      promotedDeploymentId: null,
      demotedDeploymentIds: [],
      recomputeLimitedToActingApp: false,
      recomputeSkippedDueToAmbiguousRepoScope: true,
    }
  }

  const resolvedScope = repoScopeResolution.kind === 'scoped' ? repoScopeResolution.scope : null
  const repoScope = resolvedScope ? await withHistoricalNames(client, resolvedScope) : null
  const recomputeLimitedToActingApp = !repoScope && targetAppIds.length > 1
  const recomputeScopeAppIds = recomputeLimitedToActingApp ? [appId] : targetAppIds

  const { promotedDeploymentId, demotedDeploymentIds } = await recomputeBaseline(
    client,
    recomputeScopeAppIds,
    repoScope,
    newAuditStartYear,
    adminNavIdent,
    previousAuditStartYearByAppId,
  )

  return {
    updatedAppIds: targetAppIds,
    promotedDeploymentId,
    demotedDeploymentIds,
    recomputeLimitedToActingApp,
    recomputeSkippedDueToAmbiguousRepoScope: false,
  }
}
