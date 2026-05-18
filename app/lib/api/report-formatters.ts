/**
 * Helpers for formatting audit report data for M2M API responses.
 */

import type { AuditReportSummaryM2M } from '~/lib/api/types'
import { toDateString } from '~/lib/date-utils'

interface ReportRow {
  report_id: string
  period_type: string
  period_label: string
  period_start: Date
  period_end: Date
  generated_at: Date
  generated_by: string | null
  generated_by_app: string | null
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  change_origin_count: number | null
  content_hash: string
}

export function toReportSummaryM2M(row: ReportRow): AuditReportSummaryM2M {
  return {
    reportId: row.report_id,
    periodType: row.period_type,
    periodLabel: row.period_label,
    periodStart: toDateString(row.period_start),
    periodEnd: toDateString(row.period_end),
    generatedAt: new Date(row.generated_at).toISOString(),
    generatedBy: row.generated_by_app ?? row.generated_by,
    totalDeployments: row.total_deployments,
    approvedCount: row.pr_approved_count + row.manually_approved_count,
    withChangeOriginCount: row.change_origin_count,
    contentHash: row.content_hash,
    availableFormats: ['pdf', 'xlsx'],
  }
}
