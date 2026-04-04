-- Fix bug: legacy deployments were incorrectly created with has_four_eyes = true.
-- Only reset deployments that still have a non-approved status.
-- Deployments manually reviewed (manually_approved, approved, implicitly_approved, etc.) are left untouched.
UPDATE deployments
SET has_four_eyes = false
WHERE has_four_eyes = true
  AND four_eyes_status NOT IN (
    'approved',
    'manually_approved',
    'implicitly_approved',
    'no_changes',
    'approved_pr_with_unreviewed'
  );
