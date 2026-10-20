ALTER TABLE repository_code_delivery_assessment_sync
  ADD COLUMN stack_parent_pull_request_numbers JSONB NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO repository_code_delivery_assessment_sync (delivery_id)
SELECT delivery.id
FROM repository_code_deliveries delivery
JOIN repositories repository ON repository.id = delivery.repository_id
WHERE repository.code_delivery_tracking_since IS NOT NULL
ON CONFLICT (delivery_id) DO UPDATE
SET attempt_count = 0,
    next_attempt_at = now(),
    locked_until = NULL,
    completed_at = NULL,
    failed_permanently = false,
    completed_pull_request_snapshot_ids = '{}'::jsonb,
    stack_parent_pull_request_numbers = '{}'::jsonb,
    last_error = NULL,
    updated_at = now();
