-- Functional index on LOWER(deployer_username) to support equality comparisons
-- with lowercased GitHub usernames without a full table scan.
-- The existing idx_deployments_deployer index on the raw column cannot be used
-- when the query applies LOWER() to the column.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deployments_deployer_lower
  ON deployments(LOWER(deployer_username));
