import { effectiveAuditStartYearSql } from './repository-settings-sql'

const EFFECTIVE_AUDIT_START_YEAR = effectiveAuditStartYearSql('ma')

export const AUDIT_START_YEAR_FILTER = `(d.created_at >= make_date(COALESCE(${EFFECTIVE_AUDIT_START_YEAR}, EXTRACT(YEAR FROM d.created_at)::int), 1, 1))`
