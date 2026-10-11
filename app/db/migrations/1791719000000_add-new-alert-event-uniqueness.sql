DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'repository_alerts'::regclass
      AND attname = 'old_owner'
      AND NOT attisdropped
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'repository_alerts'::regclass
      AND attname = 'expected_github_owner'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE repository_alerts RENAME COLUMN old_owner TO expected_github_owner;
    ALTER TABLE repository_alerts RENAME COLUMN old_repo TO expected_github_repo_name;
    ALTER TABLE repository_alerts RENAME COLUMN new_owner TO detected_github_owner;
    ALTER TABLE repository_alerts RENAME COLUMN new_repo TO detected_github_repo_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'repository_alerts'::regclass
      AND attname = 'resolution_notes'
      AND NOT attisdropped
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'repository_alerts'::regclass
      AND attname = 'resolution_note'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE repository_alerts RENAME COLUMN resolution_notes TO resolution_note;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'repository_alerts'::regclass
      AND attname = 'resolved'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE repository_alerts
      ADD COLUMN resolved BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE repository_alerts
    SET resolved = resolved_at IS NOT NULL;
  END IF;
END;
$migration$;

ALTER TABLE repository_alerts
  ADD COLUMN idempotency_key_enabled BOOLEAN;

ALTER TABLE repository_alerts
  ALTER COLUMN idempotency_key_enabled SET DEFAULT TRUE;

CREATE UNIQUE INDEX idx_repository_alerts_event_identity
  ON repository_alerts (
    deployment_id,
    alert_type,
    expected_github_owner,
    expected_github_repo_name,
    detected_github_owner,
    detected_github_repo_name
  )
  WHERE idempotency_key_enabled IS TRUE AND deployment_id IS NOT NULL;
