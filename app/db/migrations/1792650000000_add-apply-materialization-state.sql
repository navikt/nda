ALTER TABLE nais_apply_activity_events
  ADD COLUMN materialized_at TIMESTAMPTZ,
  ADD COLUMN materialization_retry_at TIMESTAMPTZ,
  ADD COLUMN materialization_source_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX idx_nais_apply_activity_events_unprocessed
  ON nais_apply_activity_events (monitored_app_id, created_at, id)
  WHERE materialized_at IS NULL;

CREATE INDEX idx_nais_apply_activity_events_retry
  ON nais_apply_activity_events (monitored_app_id, materialization_retry_at)
  WHERE materialization_retry_at IS NOT NULL;

CREATE INDEX idx_nais_apply_activity_events_sources
  ON nais_apply_activity_events USING GIN (materialization_source_ids);
