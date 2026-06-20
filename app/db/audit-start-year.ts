export const AUDIT_START_YEAR_FILTER =
  '(ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))'
