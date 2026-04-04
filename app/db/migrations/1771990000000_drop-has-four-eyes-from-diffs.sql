-- Drop has_four_eyes columns from tables that no longer write them.
-- Approval is now derived exclusively from four_eyes_status.

-- verification_diffs: old_has_four_eyes/new_has_four_eyes
ALTER TABLE verification_diffs DROP COLUMN IF EXISTS old_has_four_eyes;
ALTER TABLE verification_diffs DROP COLUMN IF EXISTS new_has_four_eyes;

-- verification_runs: has_four_eyes
ALTER TABLE verification_runs DROP COLUMN IF EXISTS has_four_eyes;

-- deployment_status_history: from_has_four_eyes/to_has_four_eyes
ALTER TABLE deployment_status_history DROP COLUMN IF EXISTS from_has_four_eyes;
ALTER TABLE deployment_status_history DROP COLUMN IF EXISTS to_has_four_eyes;
