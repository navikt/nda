CREATE TABLE repository_code_delivery_assessment_sync (
  delivery_id INTEGER PRIMARY KEY REFERENCES repository_code_deliveries(id) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_permanently BOOLEAN NOT NULL DEFAULT false,
  completed_association_snapshot_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_pull_request_snapshot_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO repository_code_delivery_assessment_sync (delivery_id)
SELECT delivery.id
FROM repository_code_deliveries delivery
JOIN repositories repository ON repository.id = delivery.repository_id
WHERE repository.code_delivery_tracking_since IS NOT NULL
ON CONFLICT (delivery_id) DO NOTHING;

CREATE INDEX repository_code_delivery_assessment_sync_pending_idx
  ON repository_code_delivery_assessment_sync (next_attempt_at, delivery_id)
  WHERE completed_at IS NULL AND failed_permanently = false;
