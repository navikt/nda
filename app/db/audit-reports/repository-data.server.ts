import { isFullCommitSha } from '~/lib/git-constants'
import { assessRepositoryAuditReadiness, type RepositoryAuditReportData } from '~/lib/repository-audit-report'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'
import { AUDIT_START_YEAR_FILTER } from '../audit-start-year'
import { withTransaction } from '../connection.server'
import { getStoredRepositoryDeliveryAssessments } from '../repository-delivery-assessments.server'

interface DeploymentRow {
  id: number
  nais_deployment_id: string
  created_at: Date
  commit_sha: string | null
  deployer_username: string | null
  repository_id: number | null
  repository_code_delivery_id: number | null
  branch_name: string | null
  default_branch: string | null
  trigger_event: string | null
  trigger_url: string | null
  delivery_repository_id: number | null
  base_sha: string | null
  head_sha: string | null
  github_repo_id: string | null
  github_owner: string | null
  github_repo_name: string | null
}

export async function getRepositoryAuditReportData(monitoredAppId: number, periodStart: Date, periodEnd: Date) {
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart > periodEnd) {
    throw new Error('Invalid repository audit report period')
  }
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { rows: apps } = await client.query<{
      app_name: string
      team_slug: string
      environment_name: string
      assessed_at: Date
    }>(
      `SELECT app_name, team_slug, environment_name, transaction_timestamp() AS assessed_at
       FROM monitored_applications WHERE id = $1`,
      [monitoredAppId],
    )
    const app = apps[0]
    if (!app) throw new Error(`Application ${monitoredAppId} not found`)
    if (app.environment_name !== 'prod-fss' && app.environment_name !== 'prod-gcp') {
      throw new Error('Repository audit reports require a production environment')
    }
    const { rows } = await client.query<DeploymentRow>(
      `SELECT d.id, d.nais_deployment_id, d.created_at, d.commit_sha, d.deployer_username,
              d.repository_id, d.repository_code_delivery_id, d.branch_name, d.trigger_url,
              d.workflow_trigger_config ->> 'triggerEvent' AS trigger_event,
              r.github_repo_id, r.github_owner, r.github_repo_name, r.default_branch,
              cd.repository_id AS delivery_repository_id, cd.base_sha, cd.head_sha
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       LEFT JOIN repositories r ON r.id = d.repository_id
       LEFT JOIN repository_code_deliveries cd ON cd.id = d.repository_code_delivery_id
       WHERE d.monitored_app_id = $1 AND d.created_at >= $2 AND d.created_at <= $3
         AND ${AUDIT_START_YEAR_FILTER}
       ORDER BY d.created_at ASC, d.id ASC`,
      [monitoredAppId, periodStart, periodEnd],
    )
    const repositories = new Map<number, Map<number, DeploymentRow>>()
    for (const row of rows) {
      if (row.repository_code_delivery_id === null) continue
      if (
        row.repository_id === null ||
        row.delivery_repository_id !== row.repository_id ||
        !row.commit_sha ||
        !isFullCommitSha(row.commit_sha) ||
        !row.base_sha ||
        !isFullCommitSha(row.base_sha) ||
        !row.head_sha ||
        !isFullCommitSha(row.head_sha) ||
        row.commit_sha.toLowerCase() !== row.head_sha.toLowerCase() ||
        !row.github_repo_id ||
        !row.github_owner ||
        !row.github_repo_name
      ) {
        throw new Error(`Deployment ${row.id} has an inconsistent repository code delivery link`)
      }
      const deliveries = repositories.get(row.repository_id) ?? new Map()
      deliveries.set(row.repository_code_delivery_id, row)
      repositories.set(row.repository_id, deliveries)
    }
    const report: RepositoryAuditReportData = {
      schemaVersion: 1,
      verificationSchemaVersion: CURRENT_SCHEMA_VERSION,
      assessmentModel: 'repository',
      assessmentTime: 'generation',
      assessedAt: app.assessed_at.toISOString(),
      app: { id: monitoredAppId, name: app.app_name, team: app.team_slug, environment: app.environment_name },
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      deployments: rows.map((row) => ({
        id: row.id,
        naisDeploymentId: row.nais_deployment_id,
        createdAt: row.created_at.toISOString(),
        commitSha: row.commit_sha,
        deployerUsername: row.deployer_username,
        repositoryId: row.repository_id,
        deliveryId: row.repository_code_delivery_id,
        source: {
          branch: row.branch_name,
          defaultBranch: row.default_branch,
          triggerEvent: row.trigger_event,
          triggerUrl: row.trigger_url,
        },
      })),
      deliveries: [],
    }
    for (const [repositoryId, deliveries] of repositories) {
      const intervals = [...deliveries].map(([id, row]) => {
        if (!row.base_sha || !row.head_sha) throw new Error(`Missing interval for delivery ${id}`)
        return { id, base_sha: row.base_sha, head_sha: row.head_sha }
      })
      const { assessments, lookups } = await getStoredRepositoryDeliveryAssessments(client, repositoryId, intervals)
      for (const [id, row] of deliveries) {
        const evaluated = assessments.get(id)
        if (
          !evaluated?.evidence ||
          !row.base_sha ||
          !row.head_sha ||
          !row.github_repo_id ||
          !row.github_owner ||
          !row.github_repo_name
        ) {
          throw new Error(`Missing report evidence for delivery ${id}`)
        }
        const authors = new Set(
          evaluated.interval.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
        )
        report.deliveries.push({
          id,
          repositoryId,
          githubRepoId: row.github_repo_id,
          githubOwner: row.github_owner,
          githubRepoName: row.github_repo_name,
          baseSha: row.base_sha,
          headSha: row.head_sha,
          interval: evaluated.interval,
          assessment: evaluated.assessment,
          evidence: evaluated.evidence,
          sources: evaluated.sources,
          authorIdentities: [...lookups]
            .filter(([username]) => authors.has(username))
            .map(([username, identity]) => ({
              githubUsername: username,
              activeNavIdent: identity.active_nav_ident,
              accountIdentityVersion: identity.account_identity_version,
              userIdentityVersion: identity.user_identity_version,
              accountDeletedAt: identity.account_deleted_at?.toISOString() ?? null,
            })),
          manualApprovals: evaluated.manualApprovals.map((approval) => ({
            id: approval.id,
            snapshotId: approval.snapshot_id,
            sha: approval.sha,
            authorLogin: approval.author_login,
            authorNavIdent: approval.author_nav_ident,
            reviewerNavIdent: approval.reviewer_nav_ident,
            registeredByNavIdent: approval.registered_by_nav_ident,
            reviewedAt: approval.reviewed_at.toISOString(),
            registeredAt: approval.registered_at.toISOString(),
            documentation: approval.review_documentation,
            status: approval.status,
          })),
        })
      }
    }
    return { reportData: report, readiness: assessRepositoryAuditReadiness(report) }
  })
}
