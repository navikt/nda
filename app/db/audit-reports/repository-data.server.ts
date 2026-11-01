import { isFullCommitSha } from '~/lib/git-constants'
import { parseWorkflowRunUrl } from '~/lib/github/git.server'
import { assessRepositoryAuditReadiness, type RepositoryAuditReportData } from '~/lib/repository-audit-report'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'
import { AUDIT_START_YEAR_FILTER } from '../audit-start-year'
import { withTransaction } from '../connection.server'
import { repositoryCodeDeliveryRepositoryIdSql } from '../repository-code-delivery-predecessor-sql'
import { getStoredRepositoryDeliveryAssessments } from '../repository-delivery-assessments.server'

interface DeploymentRow {
  id: number
  nais_deployment_id: string | null
  deployment_source_id: string | null
  title: string | null
  created_at: Date
  commit_sha: string | null
  github_pr_number: number | null
  deployer_username: string | null
  repository_id: number | null
  repository_code_delivery_id: number | null
  default_branch: string | null
  trigger_url: string | null
  delivery_repository_id: number | null
  base_sha: string | null
  head_sha: string | null
  github_repo_id: string | null
  github_owner: string | null
  github_repo_name: string | null
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  authorization_link_id: number | null
  authorization_status: string | null
}

interface WorkflowSnapshot {
  id: number
  fetched_at: Date
  data: {
    id?: number
    head_sha?: string
    head_branch?: string
    event?: string
    run_attempt?: number
    repository?: { id?: number }
  } | null
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
      test_requirement: string
      assessed_at: Date
    }>(
      `SELECT app_name, team_slug, environment_name, test_requirement, transaction_timestamp() AS assessed_at
       FROM monitored_applications WHERE id = $1`,
      [monitoredAppId],
    )
    const app = apps[0]
    if (!app) throw new Error(`Application ${monitoredAppId} not found`)
    if (app.environment_name !== 'prod-fss' && app.environment_name !== 'prod-gcp') {
      throw new Error('Repository audit reports require a production environment')
    }
    const { rows } = await client.query<DeploymentRow>(
      `SELECT d.id, d.nais_deployment_id, d.deployment_source_id, d.title, d.created_at, d.commit_sha, d.github_pr_number, d.deployer_username,
              ${repositoryCodeDeliveryRepositoryIdSql} AS repository_id, d.repository_code_delivery_id, d.trigger_url,
              r.github_repo_id, r.github_owner, r.github_repo_name, r.default_branch,
              d.detected_github_owner, d.detected_github_repo_name,
              ar.id AS authorization_link_id, ar.status AS authorization_status,
              cd.repository_id AS delivery_repository_id, cd.base_sha, cd.head_sha
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       LEFT JOIN repositories r ON r.id = ${repositoryCodeDeliveryRepositoryIdSql}
       LEFT JOIN LATERAL (
         SELECT id, status FROM application_repositories
         WHERE monitored_app_id = d.monitored_app_id AND github_repo_id = r.github_repo_id
           AND lower(github_owner) = lower(d.detected_github_owner)
           AND lower(github_repo_name) = lower(d.detected_github_repo_name)
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) ar ON true
       LEFT JOIN repository_code_deliveries cd ON cd.id = d.repository_code_delivery_id
       WHERE d.monitored_app_id = $1 AND d.created_at >= $2 AND d.created_at <= $3
         AND ${AUDIT_START_YEAR_FILTER}
       ORDER BY d.created_at ASC, d.id ASC`,
      [monitoredAppId, periodStart, periodEnd],
    )
    const deploymentIds = rows.map((row) => row.id)
    const goalLinksByDeployment = new Map<number, RepositoryAuditReportData['deployments'][number]['goalLinks']>()
    if (deploymentIds.length > 0) {
      const { rows: goalLinks } = await client.query<{
        deployment_id: number
        objective_title: string | null
        key_result_title: string | null
        team_name: string | null
        period_label: string | null
      }>(
        `SELECT dgl.deployment_id,
                COALESCE(bo.title, bo_via_kr.title) AS objective_title,
                bkr.title AS key_result_title,
                dt.name AS team_name,
                COALESCE(b.period_label, b_via_kr.period_label) AS period_label
         FROM deployment_goal_links dgl
         LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
         LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
         LEFT JOIN board_objectives bo_via_kr ON bo_via_kr.id = bkr.objective_id
         LEFT JOIN boards b ON b.id = bo.board_id
         LEFT JOIN boards b_via_kr ON b_via_kr.id = bo_via_kr.board_id
         LEFT JOIN dev_teams dt ON dt.id = COALESCE(b.dev_team_id, b_via_kr.dev_team_id)
         WHERE dgl.deployment_id = ANY($1)
           AND dgl.is_active = true
           AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
         ORDER BY dgl.deployment_id, dgl.created_at ASC`,
        [deploymentIds],
      )
      for (const link of goalLinks) {
        if (!link.objective_title || !link.team_name || !link.period_label) continue
        const links = goalLinksByDeployment.get(link.deployment_id) ?? []
        links.push({
          objectiveTitle: link.objective_title,
          keyResultTitle: link.key_result_title,
          teamName: link.team_name,
          periodLabel: link.period_label,
        })
        goalLinksByDeployment.set(link.deployment_id, links)
      }
    }
    const { rows: deviations } = await client.query<{
      id: number
      deployment_id: number
      date: Date
      commit_sha: string | null
      title: string | null
      github_owner: string | null
      github_repo_name: string | null
      reason: string
      breach_type: string | null
      intent: string | null
      severity: string | null
      follow_up_role: string | null
      registered_by: string
      registered_by_name: string | null
      resolved_at: Date | null
      resolution_note: string | null
    }>(
      `SELECT dd.id,
              dd.deployment_id,
              dd.created_at AS date,
              d.commit_sha,
              d.title,
              COALESCE(r.github_owner, d.detected_github_owner) AS github_owner,
              COALESCE(r.github_repo_name, d.detected_github_repo_name) AS github_repo_name,
              dd.reason,
              dd.breach_type,
              dd.intent,
              dd.severity,
              dd.follow_up_role,
              dd.registered_by,
              dd.registered_by_name,
              dd.resolved_at,
              dd.resolution_note
       FROM deployment_deviations dd
       JOIN deployments d ON d.id = dd.deployment_id
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       LEFT JOIN repositories r ON r.id = ${repositoryCodeDeliveryRepositoryIdSql}
       WHERE d.monitored_app_id = $1
         AND dd.created_at >= $2 AND dd.created_at <= $3
         AND ${AUDIT_START_YEAR_FILTER}
       ORDER BY dd.created_at ASC, dd.id ASC`,
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
    const workflowSources = new Map<number, RepositoryAuditReportData['deployments'][number]['source']>()
    const workflowCache = new Map<string, WorkflowSnapshot | null>()
    for (const row of rows) {
      const source: RepositoryAuditReportData['deployments'][number]['source'] = {
        branch: null,
        defaultBranch: row.default_branch,
        triggerEvent: null,
        triggerUrl: row.trigger_url,
        repositoryAuthorization:
          row.authorization_link_id !== null && row.authorization_status !== null
            ? { linkId: row.authorization_link_id, status: row.authorization_status }
            : null,
        workflowSnapshot: null,
      }
      const run =
        row.detected_github_owner && row.detected_github_repo_name
          ? parseWorkflowRunUrl(row.trigger_url, row.detected_github_owner, row.detected_github_repo_name)
          : null
      const attemptMatch = row.trigger_url?.match(/\/attempts\/([0-9]+)(?:[/?#]|$)/)
      const attempt = attemptMatch ? Number(attemptMatch[1]) : null
      if (
        run &&
        row.github_repo_id &&
        row.commit_sha &&
        isFullCommitSha(row.commit_sha) &&
        (attempt === null || (Number.isSafeInteger(attempt) && attempt > 0))
      ) {
        const key = `${row.github_repo_id}:${run.runId}:${attempt}`
        if (!workflowCache.has(key)) {
          const { rows: snapshots } = await client.query<WorkflowSnapshot>(
            `SELECT id, fetched_at, data FROM github_workflow_runs_raw_snapshots
             WHERE github_repo_id = $1 AND run_id = $2
               AND ($3::text IS NULL OR data->>'run_attempt' = $3)
             ORDER BY fetched_at DESC, id DESC LIMIT 1`,
            [row.github_repo_id, run.runId, attempt?.toString() ?? null],
          )
          workflowCache.set(key, snapshots[0] ?? null)
        }
        const snapshot = workflowCache.get(key)
        const data = snapshot?.data
        if (
          snapshot &&
          data?.id === run.runId &&
          (attempt === null || data.run_attempt === attempt) &&
          String(data.repository?.id) === row.github_repo_id &&
          typeof data.head_sha === 'string' &&
          data.head_sha.toLowerCase() === row.commit_sha.toLowerCase()
        ) {
          source.branch = typeof data.head_branch === 'string' ? data.head_branch : null
          source.triggerEvent = typeof data.event === 'string' ? data.event : null
          source.workflowSnapshot = {
            id: snapshot.id,
            fetchedAt: snapshot.fetched_at.toISOString(),
            runId: run.runId,
            runAttempt: Number.isSafeInteger(data.run_attempt) ? (data.run_attempt ?? null) : null,
          }
        }
      }
      workflowSources.set(row.id, source)
    }
    const report: RepositoryAuditReportData = {
      schemaVersion: 2,
      verificationSchemaVersion: CURRENT_SCHEMA_VERSION,
      assessmentModel: 'repository',
      assessmentTime: 'generation',
      assessedAt: app.assessed_at.toISOString(),
      app: {
        id: monitoredAppId,
        name: app.app_name,
        team: app.team_slug,
        environment: app.environment_name,
        testRequirement: app.test_requirement,
      },
      period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
      deployments: rows.map((row) => {
        const source = workflowSources.get(row.id)
        if (!source) throw new Error(`Missing source for deployment ${row.id}`)
        return {
          id: row.id,
          naisDeploymentId: row.nais_deployment_id,
          deploymentSourceId: row.deployment_source_id,
          title: row.title,
          createdAt: row.created_at.toISOString(),
          commitSha: row.commit_sha,
          pullRequestNumber: row.github_pr_number,
          deployerUsername: row.deployer_username,
          goalLinks: goalLinksByDeployment.get(row.id) ?? [],
          repositoryId: row.repository_id,
          deliveryId: row.repository_code_delivery_id,
          source,
        }
      }),
      deliveries: [],
      deviations: deviations.map((deviation) => ({
        id: deviation.id,
        deploymentId: deviation.deployment_id,
        date: deviation.date.toISOString(),
        commitSha: deviation.commit_sha,
        title: deviation.title,
        githubOwner: deviation.github_owner,
        githubRepoName: deviation.github_repo_name,
        reason: deviation.reason,
        breachType: deviation.breach_type,
        intent: deviation.intent,
        severity: deviation.severity,
        followUpRole: deviation.follow_up_role,
        registeredBy: deviation.registered_by,
        registeredByName: deviation.registered_by_name,
        resolvedAt: deviation.resolved_at?.toISOString() ?? null,
        resolutionNote: deviation.resolution_note,
      })),
      userDisplayNames: {},
    }
    const navIdents = new Set<string>()
    const userDisplayNames: Record<string, string> = {}
    for (const [repositoryId, deliveries] of repositories) {
      const intervals = [...deliveries].map(([id, row]) => {
        if (!row.base_sha || !row.head_sha) throw new Error(`Missing interval for delivery ${id}`)
        return { id, base_sha: row.base_sha, head_sha: row.head_sha }
      })
      const deployerUsernames = rows.flatMap((row) =>
        row.repository_id === repositoryId && row.deployer_username ? [row.deployer_username] : [],
      )
      const { assessments, lookups } = await getStoredRepositoryDeliveryAssessments(
        client,
        repositoryId,
        intervals,
        deployerUsernames,
      )
      for (const [username, lookup] of lookups) {
        if (lookup.display_name) userDisplayNames[username.toLowerCase()] = lookup.display_name
        if (lookup.nav_ident) navIdents.add(lookup.nav_ident.toUpperCase())
      }
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
        const reportDelivery = {
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
        }
        report.deliveries.push(reportDelivery)
        for (const identity of reportDelivery.authorIdentities) {
          if (identity.activeNavIdent) navIdents.add(identity.activeNavIdent.toUpperCase())
        }
        for (const approval of reportDelivery.manualApprovals) {
          navIdents.add(approval.reviewerNavIdent.toUpperCase())
          navIdents.add(approval.registeredByNavIdent.toUpperCase())
          if (approval.authorNavIdent) navIdents.add(approval.authorNavIdent.toUpperCase())
        }
      }
    }
    for (const deviation of report.deviations) {
      navIdents.add(deviation.registeredBy.toUpperCase())
    }
    if (navIdents.size > 0) {
      const { rows: users } = await client.query<{ nav_ident: string; display_name: string }>(
        `SELECT nav_ident, display_name
         FROM users
         WHERE nav_ident = ANY($1) AND deleted_at IS NULL`,
        [[...navIdents]],
      )
      for (const user of users) userDisplayNames[user.nav_ident.toUpperCase()] = user.display_name
    }
    report.userDisplayNames = userDisplayNames
    return { reportData: report, readiness: assessRepositoryAuditReadiness(report) }
  })
}
