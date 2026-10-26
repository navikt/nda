ALTER TABLE monitored_applications
  ADD COLUMN nais_apply_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE nais_apply_activity_sync_state (
  monitored_app_id INTEGER PRIMARY KEY REFERENCES monitored_applications(id) ON DELETE CASCADE,
  last_activity_created_at TIMESTAMPTZ,
  initial_history_synced_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE nais_apply_activity_events (
  id BIGSERIAL PRIMARY KEY,
  monitored_app_id INTEGER NOT NULL REFERENCES monitored_applications(id) ON DELETE CASCADE,
  activity_log_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  team_slug TEXT NOT NULL,
  environment_name TEXT,
  github_actor_claims JSONB,
  changed_fields JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (monitored_app_id, activity_log_id)
);

CREATE INDEX idx_nais_apply_activity_events_app_created
  ON nais_apply_activity_events (monitored_app_id, created_at DESC, id DESC);
