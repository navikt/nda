-- Script for å nullstille GitHub-data i databasen
-- Nyttig for å teste re-verifisering med oppdatert logikk

-- ============================================================
-- ALTERNATIV 1: Nullstill ALT GitHub-data (mest grundig)
-- ============================================================
UPDATE deployments 
SET 
  four_eyes_status = 'pending',
  github_pr_number = NULL,
  github_pr_url = NULL,
  github_pr_data = NULL,
  branch_name = NULL,
  parent_commits = NULL
WHERE commit_sha IS NOT NULL;

-- ============================================================
-- ALTERNATIV 2: Nullstill kun en spesifikk deployment
-- ============================================================
-- UPDATE deployments 
-- SET 
--   four_eyes_status = 'pending',
--   github_pr_number = NULL,
--   github_pr_url = NULL,
--   github_pr_data = NULL,
--   branch_name = NULL,
--   parent_commits = NULL
-- WHERE id = 123;  -- Bytt ut med riktig deployment ID

-- ============================================================
-- ALTERNATIV 3: Nullstill for en spesifikk app
-- ============================================================
-- UPDATE deployments 
-- SET 
--   four_eyes_status = 'pending',
--   github_pr_number = NULL,
--   github_pr_url = NULL,
--   github_pr_data = NULL,
--   branch_name = NULL,
--   parent_commits = NULL
-- WHERE monitored_app_id = 1;  -- Bytt ut med riktig app ID

-- ============================================================
-- ALTERNATIV 4: Nullstill kun deployments etter en gitt dato
-- ============================================================
-- UPDATE deployments 
-- SET 
--   four_eyes_status = 'pending',
--   github_pr_number = NULL,
--   github_pr_url = NULL,
--   github_pr_data = NULL,
--   branch_name = NULL,
--   parent_commits = NULL
-- WHERE created_at > '2026-01-28'::timestamp
--   AND commit_sha IS NOT NULL;

-- ============================================================
-- ALTERNATIV 5: Nullstill kun approved deployments (for re-test)
-- ============================================================
-- UPDATE deployments 
-- SET 
--   four_eyes_status = 'pending',
--   github_pr_data = NULL  -- Behold PR nummer/URL for raskere lookup
-- WHERE four_eyes_status = 'approved_pr'
--   AND commit_sha IS NOT NULL;

-- ============================================================
-- ALTERNATIV 6: Nullstill kun en spesifikk commit SHA
-- ============================================================
-- UPDATE deployments 
-- SET 
--   four_eyes_status = 'pending',
--   github_pr_number = NULL,
--   github_pr_url = NULL,
--   github_pr_data = NULL,
--   branch_name = NULL,
--   parent_commits = NULL
-- WHERE commit_sha = 'abc123def456';  -- Bytt ut med riktig SHA

-- ============================================================
-- Se hvilke deployments som blir påvirket før du kjører update
-- ============================================================
SELECT 
  id,
  app_name,
  commit_sha,
  four_eyes_status,
  github_pr_number,
  created_at
FROM deployments 
WHERE commit_sha IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================
-- Etter nullstilling: Se status
-- ============================================================
-- SELECT 
--   four_eyes_status,
--   COUNT(*) as count
-- FROM deployments
-- GROUP BY four_eyes_status;
