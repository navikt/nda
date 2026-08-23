import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { toDateString } from '~/lib/date-utils'
import { computeDisplayTitle, isExclusivelyThisPr } from '~/lib/delivery-title'
import { isDependabotUser } from '~/lib/dependabot'
import type { ReportPeriodType } from '~/lib/report-periods'
import { generateReportId } from '~/lib/report-periods'
import { pool } from '../connection.server'
import type { AuditReport } from './admin-retrieval.server'
import type { getAuditReportData } from './generation/query-data.server'

export interface AuditDeploymentRow {
  id: number
  nais_deployment_id: string
  title: string | null
  created_at: Date
  commit_sha: string | null
  deployer_username: string | null
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_url: string | null
  detected_github_owner: string
  detected_github_repo_name: string
  team_slug: string
  environment_name: string
  app_name: string
  approved_by_usernames: string[] | null
  pr_author: string | null
  unverified_commits: UnverifiedCommitEntry[] | null
  delivery_commit_shas: string[] | null
  pr_commit_shas: string[] | null
}

export interface AdminResetEntry {
  deployment_id: number
  reset_at: string
  reset_by: string
  reason: string
}

export interface AuditReportData {
  deployments: AuditDeploymentEntry[]
  manual_approvals: ManualApprovalEntry[]
  contributors: ContributorEntry[]
  reviewers: ReviewerEntry[]
  legacy_count: number
  baseline_count?: number
  deviations: DeviationEntry[]
  unverified_commit_deployments: UnverifiedCommitDeploymentEntry[]
  show_unverified_commits_note: boolean
  admin_resets: AdminResetEntry[]
}

export interface DeviationEntry {
  deployment_id: number
  date: string
  commit_sha: string
  reason: string
  breach_type: string | null
  intent: string | null
  severity: string | null
  follow_up_role: string | null
  registered_by: string
  registered_by_name: string | null
  resolved_at: string | null
  resolution_note: string | null
}

export interface AuditGoalLinkEntry {
  objective_title: string
  key_result_title: string | null
  team_name: string
  period_label: string
}

export interface AuditDeploymentEntry {
  id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  method: 'pr' | 'manual' | 'legacy' | 'baseline'
  pr_author?: string
  pr_author_display_name?: string
  deployer: string
  deployer_display_name?: string
  approver: string
  approver_display_name?: string
  pr_number?: number
  pr_url?: string
  slack_link?: string
  goal_links?: AuditGoalLinkEntry[]
  delivery_commit_count?: number
}

export interface ManualApprovalEntry {
  deployment_id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  deployer: string
  deployer_display_name?: string
  reason: string
  registered_by: string
  registered_by_display_name?: string
  approved_by: string
  approved_by_display_name?: string
  approved_at: string
  slack_link: string
  comment: string
}

export interface ContributorEntry {
  github_username: string
  display_name: string | null
  nav_ident: string | null
  deployment_count: number
}

export interface ReviewerEntry {
  github_username: string
  display_name: string | null
  review_count: number
}

export interface UnverifiedCommitEntry {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string
}

export interface UnverifiedCommitDeploymentEntry {
  deployment_id: number
  date: string
  commit_sha: string
  title: string
  deployer: string
  deployer_display_name?: string
  four_eyes_status: string
  approved_by?: string
  approved_by_display_name?: string
  approved_at?: string
  commits: UnverifiedCommitEntry[]
}

export { getAuditReportData } from './generation/query-data.server'

export function buildReportData(rawData: Awaited<ReturnType<typeof getAuditReportData>>): AuditReportData {
  const {
    deployments,
    manual_approvals,
    legacy_infos,
    baseline_approvals,
    admin_resets: rawAdminResets,
    reviewer_counts,
    user_mappings: userLookups,
    canonical_map,
    deviations: rawDeviations,
    goal_links_by_deployment,
  } = rawData
  const manualApprovalMap = new Map(manual_approvals.map((a) => [a.deployment_id, a]))
  const legacyInfoMap = new Map(legacy_infos.map((l) => [l.deployment_id, l]))
  const baselineApprovalMap = new Map(baseline_approvals.map((b) => [b.deployment_id, b]))

  const getDisplayName = (identifier: string | null | undefined): string | undefined => {
    if (!identifier) return undefined
    const canonical = canonical_map.get(identifier) || identifier
    return userLookups.get(canonical)?.display_name || undefined
  }

  const getCanonical = (identifier: string): string => {
    return canonical_map.get(identifier) || identifier
  }

  const deploymentEntries: AuditDeploymentEntry[] = deployments.map((d) => {
    const isManual = d.four_eyes_status === 'manually_approved'
    const isLegacy = d.four_eyes_status === 'legacy'
    const isBaseline = d.four_eyes_status === 'baseline'
    const manualApproval = manualApprovalMap.get(d.id)
    const legacyInfo = legacyInfoMap.get(d.id)
    const baselineApproval = baselineApprovalMap.get(d.id)
    const hasLegacyInfo = !!legacyInfo

    const formatApprovers = (usernames: string[]): string => {
      return usernames.map((u) => getDisplayName(u) || u).join(', ')
    }

    let approver = ''
    if (isLegacy || hasLegacyInfo) {
      approver = d.approved_by_usernames?.length ? formatApprovers(d.approved_by_usernames) : '-'
    } else if (isBaseline) {
      if (!baselineApproval?.changed_by) {
        throw new Error(
          `Baseline deployment ${d.id} is missing an approver in deployment_status_history. ` +
            `Cannot generate audit report with unattributed baseline approval.`,
        )
      }
      approver = getDisplayName(baselineApproval.changed_by) || baselineApproval.changed_by
    } else if (isManual && manualApproval) {
      approver = getDisplayName(manualApproval.approved_by) || manualApproval.approved_by
    } else if (d.approved_by_usernames?.length) {
      approver = formatApprovers(d.approved_by_usernames)
    }

    let method: 'pr' | 'manual' | 'legacy' | 'baseline' = 'pr'
    if (isLegacy || hasLegacyInfo) {
      method = 'legacy'
    } else if (isBaseline) {
      method = 'baseline'
    } else if (isManual) {
      method = 'manual'
    }

    const deliveryCommitShas = d.delivery_commit_shas ?? []
    const prCommitShas = d.pr_commit_shas ? new Set(d.pr_commit_shas) : null
    const exclusivelyThisPr = isExclusivelyThisPr(d.github_pr_number != null, deliveryCommitShas, prCommitShas)
    const deliveryCommitCount = deliveryCommitShas.length || 1
    const displayTitle = computeDisplayTitle(d.title, deliveryCommitCount, exclusivelyThisPr)

    return {
      id: d.id,
      nais_deployment_id: d.nais_deployment_id,
      title: displayTitle || '',
      date: d.created_at.toISOString(),
      commit_sha: d.commit_sha || '',
      method,
      pr_author: d.pr_author || undefined,
      pr_author_display_name: getDisplayName(d.pr_author),
      deployer: d.deployer_username || '',
      deployer_display_name: getDisplayName(d.deployer_username),
      approver,
      approver_display_name: undefined,
      pr_number: d.github_pr_number || undefined,
      pr_url: d.github_pr_url || undefined,
      slack_link: manualApproval?.slack_link || undefined,
      goal_links: goal_links_by_deployment.get(d.id) || undefined,
      delivery_commit_count: deliveryCommitCount,
    }
  })

  const manualApprovalEntries: ManualApprovalEntry[] = manual_approvals.map((a) => {
    const deployment = deployments.find((d) => d.id === a.deployment_id)
    const legacyInfo = legacyInfoMap.get(a.deployment_id)

    let reason = 'Ekstra commits etter godkjenning'
    if (legacyInfo) {
      reason = 'Legacy deployment (GitHub-verifisert)'
    } else if (deployment?.four_eyes_status === 'direct_push') {
      reason = 'Direct push til main'
    }

    return {
      deployment_id: a.deployment_id,
      nais_deployment_id: deployment!.nais_deployment_id,
      title:
        computeDisplayTitle(
          deployment?.title ?? null,
          deployment?.delivery_commit_shas?.length || 1,
          isExclusivelyThisPr(
            deployment?.github_pr_number != null,
            deployment?.delivery_commit_shas ?? [],
            deployment?.pr_commit_shas ? new Set(deployment.pr_commit_shas) : null,
          ),
        ) || '',
      date: deployment?.created_at.toISOString() || '',
      commit_sha: deployment?.commit_sha || '',
      deployer: deployment?.deployer_username || '',
      deployer_display_name: getDisplayName(deployment?.deployer_username),
      reason,
      registered_by: legacyInfo?.registered_by || '',
      registered_by_display_name: getDisplayName(legacyInfo?.registered_by),
      approved_by: a.approved_by,
      approved_by_display_name: getDisplayName(a.approved_by),
      approved_at: a.approved_at.toISOString(),
      slack_link: a.slack_link,
      comment: a.comment_text,
    }
  })

  const contributorCounts = new Map<string, number>()
  for (const d of deployments) {
    if (d.deployer_username) {
      const canonical = getCanonical(d.deployer_username)
      contributorCounts.set(canonical, (contributorCounts.get(canonical) || 0) + 1)
    }
  }
  const contributors: ContributorEntry[] = Array.from(contributorCounts.entries())
    .map(([username, count]) => ({
      github_username: username,
      display_name: userLookups.get(username)?.display_name || null,
      nav_ident: userLookups.get(username)?.nav_ident || null,
      deployment_count: count,
    }))
    .sort((a, b) => b.deployment_count - a.deployment_count)

  const combinedReviewerCounts = new Map<string, number>()
  for (const [username, count] of reviewer_counts) {
    const canonical = getCanonical(username)
    combinedReviewerCounts.set(canonical, (combinedReviewerCounts.get(canonical) || 0) + count)
  }
  for (const a of manual_approvals) {
    if (a.approved_by) {
      const canonical = getCanonical(a.approved_by)
      combinedReviewerCounts.set(canonical, (combinedReviewerCounts.get(canonical) || 0) + 1)
    }
  }
  const reviewers: ReviewerEntry[] = Array.from(combinedReviewerCounts.entries())
    .map(([username, count]) => ({
      github_username: username,
      display_name: userLookups.get(username)?.display_name || null,
      review_count: count,
    }))
    .sort((a, b) => b.review_count - a.review_count)

  const legacyCount = deploymentEntries.filter((d) => d.method === 'legacy').length
  const baselineCount = deploymentEntries.filter((d) => d.method === 'baseline').length

  const deviationEntries: DeviationEntry[] = rawDeviations.map((d) => {
    const deployment = deployments.find((dep) => dep.id === d.deployment_id)
    return {
      deployment_id: d.deployment_id,
      date: d.created_at.toISOString(),
      commit_sha: deployment?.commit_sha || '',
      reason: d.reason,
      breach_type: d.breach_type || null,
      intent: d.intent || null,
      severity: d.severity || null,
      follow_up_role: d.follow_up_role || null,
      registered_by: d.registered_by,
      registered_by_name: d.registered_by_name || getDisplayName(d.registered_by) || null,
      resolved_at: d.resolved_at?.toISOString() || null,
      resolution_note: d.resolution_note || null,
    }
  })

  const manualApprovalByDeployment = new Map(manual_approvals.map((a) => [a.deployment_id, a]))
  const unverifiedCommitDeployments: UnverifiedCommitDeploymentEntry[] = deployments
    .filter((d) => d.unverified_commits && d.unverified_commits.length > 0)
    .map((d) => {
      const manualApproval = manualApprovalByDeployment.get(d.id)
      const isManuallyApproved = d.four_eyes_status === 'manually_approved'

      return {
        deployment_id: d.id,
        date: d.created_at.toISOString(),
        commit_sha: d.commit_sha || '',
        title:
          computeDisplayTitle(
            d.title,
            d.delivery_commit_shas?.length || 1,
            isExclusivelyThisPr(
              d.github_pr_number != null,
              d.delivery_commit_shas ?? [],
              d.pr_commit_shas ? new Set(d.pr_commit_shas) : null,
            ),
          ) || '',
        deployer: d.deployer_username || '',
        deployer_display_name: getDisplayName(d.deployer_username),
        four_eyes_status: d.four_eyes_status,
        approved_by: isManuallyApproved && manualApproval ? manualApproval.approved_by : undefined,
        approved_by_display_name:
          isManuallyApproved && manualApproval ? getDisplayName(manualApproval.approved_by) : undefined,
        approved_at: isManuallyApproved && manualApproval ? manualApproval.approved_at.toISOString() : undefined,
        commits: d.unverified_commits ?? [],
      }
    })

  const adminResetEntries: AdminResetEntry[] = rawAdminResets.map((r) => ({
    deployment_id: r.deployment_id,
    reset_at: r.created_at.toISOString(),
    reset_by: r.changed_by ? getDisplayName(r.changed_by) || r.changed_by : 'ukjent',
    reason: r.details?.reason ?? '',
  }))

  const UNVERIFIED_COMMITS_CUTOFF = new Date('2026-01-31T00:00:00Z')
  const showUnverifiedCommitsNote = deployments.some((d) => d.created_at < UNVERIFIED_COMMITS_CUTOFF)

  return {
    deployments: deploymentEntries,
    manual_approvals: manualApprovalEntries,
    contributors,
    reviewers,
    legacy_count: legacyCount,
    baseline_count: baselineCount,
    deviations: deviationEntries,
    unverified_commit_deployments: unverifiedCommitDeployments,
    show_unverified_commits_note: showUnverifiedCommitsNote,
    admin_resets: adminResetEntries,
  }
}

function calculateReportHash(reportData: AuditReportData): string {
  const json = JSON.stringify(reportData)
  return createHash('sha256').update(json).digest('hex')
}

export async function saveAuditReport(params: {
  monitoredAppId: number
  appName: string
  teamSlug: string
  environmentName: string
  repository: string
  year: number
  periodType: ReportPeriodType
  periodLabel: string
  periodStart: Date
  periodEnd: Date
  reportData: AuditReportData
  generatedBy?: string
  generatedByApp?: string
  supersedeReason?: string
}): Promise<AuditReport> {
  const {
    monitoredAppId,
    appName,
    teamSlug,
    environmentName,
    repository,
    year,
    periodType,
    periodLabel,
    periodStart,
    periodEnd,
    reportData,
    generatedBy,
    generatedByApp,
    supersedeReason,
  } = params

  const contentHash = calculateReportHash(reportData)
  const reportId = generateReportId(periodType, periodLabel, appName, environmentName, contentHash)

  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length

  const changeOriginCount = reportData.deployments.filter(
    (d) => d.goal_links && d.goal_links.length > 0 && !isDependabotUser(d.pr_author),
  ).length

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const supersededIds = await supersedeExistingReports(
      client,
      monitoredAppId,
      periodType,
      periodStart,
      periodEnd,
      generatedBy ?? generatedByApp,
      supersedeReason,
    )

    if (supersededIds.length > 0 && !supersedeReason) {
      throw new Error('An active report already exists for this period. You must provide a reason to supersede it.')
    }

    const result = await client.query<AuditReport>(
      `INSERT INTO audit_reports (
        report_id, monitored_app_id, app_name, team_slug, environment_name, repository,
        year, period_type, period_label, period_start, period_end,
        total_deployments, pr_approved_count, manually_approved_count,
        unique_deployers, unique_reviewers,
        report_data, content_hash, generated_by, generated_by_app, change_origin_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        reportId,
        monitoredAppId,
        appName,
        teamSlug,
        environmentName,
        repository,
        year,
        periodType,
        periodLabel,
        toDateString(periodStart),
        toDateString(periodEnd),
        reportData.deployments.length,
        prApprovedCount,
        manuallyApprovedCount,
        reportData.contributors.length,
        reportData.reviewers.length,
        JSON.stringify(reportData),
        contentHash,
        generatedBy || null,
        generatedByApp || null,
        changeOriginCount,
      ],
    )

    const newReport = result.rows[0]

    if (supersededIds.length > 0) {
      await client.query(`UPDATE audit_reports SET superseded_by_report_id = $1 WHERE id = ANY($2)`, [
        newReport.id,
        supersededIds,
      ])
    }

    await client.query('COMMIT')
    return newReport
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function supersedeExistingReports(
  client: PoolClient,
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
  periodEnd: Date,
  supersededBy?: string,
  supersedeReason?: string,
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE audit_reports
     SET superseded_at = NOW(),
         superseded_by = $1,
         supersede_reason = $2
     WHERE monitored_app_id = $3
       AND period_type = $4
       AND period_start = $5::date
       AND period_end = $6::date
       AND superseded_at IS NULL
       AND archived_at IS NULL
     RETURNING id`,
    [
      supersededBy || null,
      supersedeReason || null,
      monitoredAppId,
      periodType,
      toDateString(periodStart),
      toDateString(periodEnd),
    ],
  )
  return result.rows.map((r) => r.id)
}
