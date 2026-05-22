-- Add 'monthly' to boards period_type CHECK constraint
ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_period_type_check;
ALTER TABLE boards ADD CONSTRAINT boards_period_type_check
  CHECK (period_type IN ('tertiary', 'quarterly', 'monthly'));
