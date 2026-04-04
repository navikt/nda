-- Fix bug: legacy deployments were incorrectly created with has_four_eyes = true.
-- Only reset deployments that still have four_eyes_status = 'legacy'.
-- Deployments manually reviewed (manually_approved, approved, etc.) are left untouched.
UPDATE deployments
SET has_four_eyes = false
WHERE four_eyes_status = 'legacy'
  AND has_four_eyes = true;
