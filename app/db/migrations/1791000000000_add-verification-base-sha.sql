ALTER TABLE deployments
ADD COLUMN verification_base_sha VARCHAR(40);

UPDATE deployments d
SET verification_base_sha = (
  SELECT previous.commit_sha
  FROM deployments previous
  JOIN application_repositories previous_repo
    ON previous_repo.monitored_app_id = previous.monitored_app_id
    AND previous_repo.github_owner = previous.detected_github_owner
    AND previous_repo.github_repo_name = previous.detected_github_repo_name
    AND previous_repo.status IN ('active', 'historical')
  JOIN application_repositories current_repo
    ON current_repo.monitored_app_id = d.monitored_app_id
    AND current_repo.github_owner = d.detected_github_owner
    AND current_repo.github_repo_name = d.detected_github_repo_name
    AND current_repo.github_repo_id = previous_repo.github_repo_id
    AND current_repo.status IN ('active', 'historical')
  WHERE previous.monitored_app_id = d.monitored_app_id
    AND previous.created_at < d.created_at
    AND previous.commit_sha IS NOT NULL
    AND previous.commit_sha !~ '^refs/'
    AND previous.four_eyes_status NOT IN ('legacy', 'legacy_pending', 'unverifiable')
  ORDER BY previous.created_at DESC
  LIMIT 1
)
WHERE d.commit_sha IS NOT NULL;

COMMENT ON COLUMN deployments.verification_base_sha IS 'Base commit SHA from the app-local deployment comparison link used to match sibling approvals';

COMMENT ON COLUMN deployment_status_history.change_source IS
  'Source of change: verification, manual_approval, reverification, sync, legacy, baseline_approval, admin_reset, sibling_propagation';
