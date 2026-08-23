import { computeDisplayTitle, isExclusivelyThisPr } from '~/lib/delivery-title'
import type { getAuditReportData } from './generation/query-data.server'
import type {
  AdminResetEntry,
  AuditDeploymentEntry,
  AuditReportData,
  ContributorEntry,
  DeviationEntry,
  ManualApprovalEntry,
  ReviewerEntry,
  UnverifiedCommitDeploymentEntry,
} from './generation/types'

export { getAuditReportData } from './generation/query-data.server'
export type {
  AdminResetEntry,
  AuditDeploymentEntry,
  AuditDeploymentRow,
  AuditGoalLinkEntry,
  AuditReportData,
  ContributorEntry,
  DeviationEntry,
  ManualApprovalEntry,
  ReviewerEntry,
  UnverifiedCommitDeploymentEntry,
  UnverifiedCommitEntry,
} from './generation/types'

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

export { saveAuditReport } from './generation/save-report.server'
