-- Back-fill registered_by on manual_approval comments where it is NULL.
--
-- For manual approvals, approved_by is always the person who performed the
-- action, making it the correct value for registered_by. Most NULL rows were
-- created before commit 23fbfbd (2026-05-24) which fixed the omission, but the
-- update is safe for any such row regardless of when it was created.
UPDATE deployment_comments
SET registered_by = approved_by
WHERE comment_type = 'manual_approval'
  AND registered_by IS NULL
  AND approved_by IS NOT NULL;
