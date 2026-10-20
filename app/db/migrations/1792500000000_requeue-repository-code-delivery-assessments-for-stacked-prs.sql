UPDATE repository_code_delivery_assessment_sync sync
SET attempt_count = 0,
    next_attempt_at = now(),
    locked_until = NULL,
    completed_at = NULL,
    failed_permanently = false,
    last_error = NULL,
    updated_at = now()
FROM repository_code_deliveries delivery
JOIN repositories repository ON repository.id = delivery.repository_id
WHERE sync.delivery_id = delivery.id
  AND repository.code_delivery_tracking = true;
