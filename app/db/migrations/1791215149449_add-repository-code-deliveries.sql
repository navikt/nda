CREATE TABLE repository_code_deliveries (
  id SERIAL PRIMARY KEY,
  repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  base_sha VARCHAR(40) NOT NULL CHECK (length(base_sha) = 40 AND base_sha ~ '^[0-9a-fA-F]{40}$'),
  head_sha VARCHAR(40) NOT NULL CHECK (length(head_sha) = 40 AND head_sha ~ '^[0-9a-fA-F]{40}$'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX repository_code_deliveries_repository_head_unique
  ON repository_code_deliveries (repository_id, lower(head_sha));
