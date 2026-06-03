-- Indexes to speed up board-based deployment counting in getDevTeamStatsBatch.
-- board_objectives and board_key_results had no indexes on their foreign keys,
-- causing sequential scans on every board/objective/KR lookup in the hot path.

CREATE INDEX IF NOT EXISTS idx_board_objectives_board
  ON board_objectives(board_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_board_key_results_objective
  ON board_key_results(objective_id)
  WHERE is_active = true;

-- Composite index to support the (monitored_app_id, created_at) filter pattern
-- used in unlinked_member and board_linked CTEs.
CREATE INDEX IF NOT EXISTS idx_deployments_app_created
  ON deployments(monitored_app_id, created_at DESC);
