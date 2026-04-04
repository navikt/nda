-- Test data for alerts.tsx
-- Run this against your test database to see alerts in the UI

-- First, ensure we have a monitored application
INSERT INTO monitored_applications (team_slug, environment_name, app_name, is_active)
VALUES 
  ('pensjon-test', 'dev-gcp', 'pensjon-testapp', TRUE),
  ('pensjon-test', 'prod-gcp', 'pensjon-prodapp', TRUE)
ON CONFLICT (team_slug, environment_name, app_name) DO UPDATE SET is_active = TRUE
RETURNING id;

-- Get the app IDs (or use subqueries below)
-- Note: Run the INSERT above first, then check the IDs returned

-- Insert test deployments (need deployment_id for alerts)
-- Using subquery to get monitored_app_id

INSERT INTO deployments (
  monitored_app_id,
  nais_deployment_id,
  created_at,
  deployer_username,
  commit_sha,
  trigger_url,
  detected_github_owner,
  detected_github_repo_name,
  four_eyes_status
)
SELECT 
  ma.id,
  'TEST_DEPLOY_ALERT_' || i,
  NOW() - (i || ' hours')::interval,
  CASE 
    WHEN i % 3 = 0 THEN 'testuser1'
    WHEN i % 3 = 1 THEN 'testuser2'
    ELSE 'testuser3'
  END,
  md5(random()::text),
  'https://github.com/navikt/some-repo/actions/runs/' || (1000000 + i),
  'navikt',
  CASE 
    WHEN i = 1 THEN 'pensjon-wrong-repo'
    WHEN i = 2 THEN 'pensjon-renamed-repo'
    WHEN i = 3 THEN 'pensjon-pending-repo'
    WHEN i = 4 THEN 'pensjon-another-wrong'
    ELSE 'pensjon-testapp'
  END,
  'pending'
FROM monitored_applications ma
CROSS JOIN generate_series(1, 5) AS i
WHERE ma.app_name = 'pensjon-testapp'
ON CONFLICT (nais_deployment_id) DO NOTHING;

-- Insert test alerts with different types
-- Alert 1: Repository mismatch (unexpected repo)
INSERT INTO repository_alerts (
  monitored_app_id,
  deployment_id,
  alert_type,
  expected_github_owner,
  expected_github_repo_name,
  detected_github_owner,
  detected_github_repo_name,
  resolved,
  created_at
)
SELECT 
  d.monitored_app_id,
  d.id,
  'repository_mismatch',
  'navikt',
  'pensjon-testapp',
  d.detected_github_owner,
  d.detected_github_repo_name,
  FALSE,
  d.created_at
FROM deployments d
WHERE d.nais_deployment_id = 'TEST_DEPLOY_ALERT_1';

-- Alert 2: Historical repository (old repo still being used)
INSERT INTO repository_alerts (
  monitored_app_id,
  deployment_id,
  alert_type,
  expected_github_owner,
  expected_github_repo_name,
  detected_github_owner,
  detected_github_repo_name,
  resolved,
  created_at
)
SELECT 
  d.monitored_app_id,
  d.id,
  'historical_repository',
  'navikt',
  'pensjon-testapp',
  d.detected_github_owner,
  d.detected_github_repo_name,
  FALSE,
  d.created_at
FROM deployments d
WHERE d.nais_deployment_id = 'TEST_DEPLOY_ALERT_2';

-- Alert 3: Pending approval (new repo detected, needs approval)
INSERT INTO repository_alerts (
  monitored_app_id,
  deployment_id,
  alert_type,
  expected_github_owner,
  expected_github_repo_name,
  detected_github_owner,
  detected_github_repo_name,
  resolved,
  created_at
)
SELECT 
  d.monitored_app_id,
  d.id,
  'pending_approval',
  'navikt',
  'pensjon-testapp',
  d.detected_github_owner,
  d.detected_github_repo_name,
  FALSE,
  d.created_at
FROM deployments d
WHERE d.nais_deployment_id = 'TEST_DEPLOY_ALERT_3';

-- Alert 4: Another mismatch
INSERT INTO repository_alerts (
  monitored_app_id,
  deployment_id,
  alert_type,
  expected_github_owner,
  expected_github_repo_name,
  detected_github_owner,
  detected_github_repo_name,
  resolved,
  created_at
)
SELECT 
  d.monitored_app_id,
  d.id,
  'repository_mismatch',
  'navikt',
  'pensjon-testapp',
  d.detected_github_owner,
  d.detected_github_repo_name,
  FALSE,
  d.created_at
FROM deployments d
WHERE d.nais_deployment_id = 'TEST_DEPLOY_ALERT_4';

-- Verify what was inserted
SELECT 'Alerts created:' as info;
SELECT 
  ra.id,
  ra.alert_type,
  ma.app_name,
  ma.environment_name,
  ra.expected_github_repo_name as expected_repo,
  ra.detected_github_repo_name as detected_repo,
  ra.resolved,
  ra.created_at
FROM repository_alerts ra
JOIN monitored_applications ma ON ra.monitored_app_id = ma.id
WHERE ra.resolved = FALSE
ORDER BY ra.created_at DESC;

-- Cleanup command (uncomment to remove test data)
-- DELETE FROM repository_alerts WHERE deployment_id IN (SELECT id FROM deployments WHERE nais_deployment_id LIKE 'TEST_DEPLOY_ALERT_%');
-- DELETE FROM deployments WHERE nais_deployment_id LIKE 'TEST_DEPLOY_ALERT_%';
-- DELETE FROM monitored_applications WHERE app_name IN ('pensjon-testapp', 'pensjon-prodapp') AND team_slug = 'pensjon-test';
