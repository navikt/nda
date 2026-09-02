import type { PoolClient } from 'pg'
import { computeBaselineRecomputePlan } from '~/lib/audit-start-year-baseline'
import { type FourEyesStatus, LEGACY_STATUSES_SQL, UNAUTHORIZED_STATUSES_SQL } from '~/lib/four-eyes-status'
import { withTransaction } from './connection.server'

const ELIGIBLE_DEPLOYMENT_SQL = `
  d.commit_sha IS NOT NULL
  AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
  AND d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
  AND d.commit_sha !~ '^refs/'
`

interface MarkerRow {
  id: number
  four_eyes_status: FourEyesStatus
  monitored_app_id: number
}

interface RepoScope {
  owner: string
  repo: string
}

type RepoScopeResolution = { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'scoped'; scope: RepoScope }

async function getTargetAppIds(client: PoolClient, appId: number): Promise<number[]> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM monitored_applications WHERE id = $1`, [appId])
  const app = rows[0]
  if (!app) {
    throw new Error(`Monitored application ${appId} not found`)
  }

  const targetAppIds = new Set<number>([appId])

  const { rows: repoSiblings } = await client.query<{ id: number }>(
    `SELECT ma.id
     FROM application_repositories ar
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE ar.status = 'active'
       AND ma.is_active = true
       AND ar.github_repo_id IS NOT NULL
       AND ar.github_repo_id IN (
         SELECT github_repo_id FROM application_repositories
         WHERE monitored_app_id = $1 AND status = 'active' AND github_repo_id IS NOT NULL
       )`,
    [appId],
  )
  for (const sibling of repoSiblings) {
    targetAppIds.add(sibling.id)
  }

  return [...targetAppIds]
}

async function resolveRepoScope(client: PoolClient, appIds: number[]): Promise<RepoScopeResolution> {
  const { rows } = await client.query<{ github_owner: string; github_repo_name: string }>(
    `SELECT DISTINCT github_owner, github_repo_name
     FROM application_repositories
     WHERE monitored_app_id = ANY($1) AND status = 'active'`,
    [appIds],
  )
  if (rows.length === 0) return { kind: 'none' }
  if (rows.length > 1) return { kind: 'ambiguous' }
  const row = rows[0]
  if (!row) return { kind: 'none' }
  return { kind: 'scoped', scope: { owner: row.github_owner, repo: row.github_repo_name } }
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

function appendRepoScope(params: unknown[], repoScope: RepoScope | null): string {
  if (!repoScope) return ''
  const ownerIdx = params.length + 1
  const repoIdx = params.length + 2
  params.push(repoScope.owner, repoScope.repo)
  return ` AND d.detected_github_owner = $${ownerIdx} AND d.detected_github_repo_name = $${repoIdx}`
}

function appendMarkerRepoScope(params: unknown[], repoScope: RepoScope | null): string {
  if (!repoScope) return ''
  const ownerIdx = params.length + 1
  const repoIdx = params.length + 2
  params.push(repoScope.owner, repoScope.repo)
  return ` AND (
    (d.detected_github_owner = $${ownerIdx} AND d.detected_github_repo_name = $${repoIdx})
    OR (d.detected_github_owner IS NULL AND d.detected_github_repo_name IS NULL)
  )`
}

async function recomputeBaseline(
  client: PoolClient,
  appIds: number[],
  repoScope: RepoScope | null,
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

export async function applyAuditStartYearChange(
  appId: number,
  newAuditStartYear: number | null,
  adminNavIdent: string,
): Promise<AuditStartYearChangeResult> {
  return withTransaction(async (client) => {
    const targetAppIds = await getTargetAppIds(client, appId)

    const { rows: currentYearRows } = await client.query<{ id: number; audit_start_year: number | null }>(
      `SELECT id, audit_start_year FROM monitored_applications WHERE id = ANY($1)`,
      [targetAppIds],
    )
    const previousAuditStartYearByAppId = new Map<number, number | null>(
      currentYearRows.map((row) => [row.id, row.audit_start_year]),
    )

    await client.query(
      `UPDATE monitored_applications SET audit_start_year = $1, updated_at = now() WHERE id = ANY($2)`,
      [newAuditStartYear, targetAppIds],
    )

    const repoScopeResolution = await resolveRepoScope(client, targetAppIds)

    if (repoScopeResolution.kind === 'ambiguous') {
      return {
        updatedAppIds: targetAppIds,
        promotedDeploymentId: null,
        demotedDeploymentIds: [],
        recomputeLimitedToActingApp: false,
        recomputeSkippedDueToAmbiguousRepoScope: true,
      }
    }

    const repoScope = repoScopeResolution.kind === 'scoped' ? repoScopeResolution.scope : null
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
  })
}
