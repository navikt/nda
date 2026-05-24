-- Back-fill registered_by on manual_approval comments that were created before
-- the fix in commit 23fbfbd (2026-05-24) which ensured registered_by was stored.
--
-- For manual approvals, approved_by is always the person who performed the action,
-- so it is the correct value to use for registered_by.
UPDATE deployment_comments
SET registered_by = approved_by
WHERE comment_type = 'manual_approval'
  AND registered_by IS NULL
  AND approved_by IS NOT NULL;
