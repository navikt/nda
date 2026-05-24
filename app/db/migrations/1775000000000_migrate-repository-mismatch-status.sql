-- Migrate legacy 'repository_mismatch' deployment status to 'unauthorized_repository'.
--
-- The 'repository_mismatch' status was used by an older implementation.
-- The current verification engine (verify.ts) has always produced
-- 'unauthorized_repository' instead. Historical rows with the old status
-- are updated here so the status set is consistent going forward.

UPDATE deployments
SET four_eyes_status = 'unauthorized_repository'
WHERE four_eyes_status = 'repository_mismatch';
