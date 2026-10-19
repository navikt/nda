CREATE TABLE repository_approval_snapshots (
  id SERIAL PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES repository_code_deliveries(id),
  repository_id INTEGER NOT NULL REFERENCES repositories(id),
  base_sha TEXT NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
  head_sha TEXT NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  evaluator_version INTEGER NOT NULL CHECK (evaluator_version > 0),
  evidence JSONB NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE repository_approval_snapshot_commits (
  snapshot_id INTEGER NOT NULL REFERENCES repository_approval_snapshots(id),
  sha TEXT NOT NULL CHECK (sha ~ '^[0-9a-f]{40}$'),
  author_login TEXT,
  author_nav_ident TEXT,
  account_identity_version BIGINT,
  user_identity_version BIGINT,
  PRIMARY KEY (snapshot_id, sha)
);

CREATE TABLE repository_manual_approvals (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES repository_approval_snapshots(id),
  reviewer_nav_ident TEXT NOT NULL CHECK (reviewer_nav_ident ~ '^[A-Z][0-9]{6}$'),
  registered_by_nav_ident TEXT NOT NULL CHECK (registered_by_nav_ident = reviewer_nav_ident),
  reviewed_at TIMESTAMPTZ NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (reviewed_at <= registered_at),
  UNIQUE (id, snapshot_id)
);

CREATE TABLE repository_manual_approval_commits (
  approval_id INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  PRIMARY KEY (approval_id, sha),
  FOREIGN KEY (approval_id, snapshot_id) REFERENCES repository_manual_approvals(id, snapshot_id),
  FOREIGN KEY (snapshot_id, sha) REFERENCES repository_approval_snapshot_commits(snapshot_id, sha)
);

CREATE TABLE repository_manual_approval_events (
  id SERIAL PRIMARY KEY,
  approval_id INTEGER NOT NULL REFERENCES repository_manual_approvals(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'revoked')),
  actor_nav_ident TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (event_type <> 'revoked' OR length(trim(reason)) > 0 AND reason IS NOT NULL),
  UNIQUE (approval_id, event_type)
);

CREATE INDEX repository_approval_snapshots_delivery ON repository_approval_snapshots(repository_id, delivery_id);
CREATE INDEX repository_manual_approvals_snapshot ON repository_manual_approvals(snapshot_id);

CREATE FUNCTION reject_repository_approval_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Repository approval history is immutable';
END;
$$;

CREATE TRIGGER immutable_repository_approval_snapshots
BEFORE UPDATE OR DELETE ON repository_approval_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_repository_approval_mutation();

CREATE TRIGGER immutable_repository_approval_snapshot_commits
BEFORE UPDATE OR DELETE ON repository_approval_snapshot_commits
FOR EACH ROW EXECUTE FUNCTION reject_repository_approval_mutation();

CREATE TRIGGER immutable_repository_manual_approvals
BEFORE UPDATE OR DELETE ON repository_manual_approvals
FOR EACH ROW EXECUTE FUNCTION reject_repository_approval_mutation();

CREATE TRIGGER immutable_repository_manual_approval_commits
BEFORE UPDATE OR DELETE ON repository_manual_approval_commits
FOR EACH ROW EXECUTE FUNCTION reject_repository_approval_mutation();

CREATE TRIGGER immutable_repository_manual_approval_events
BEFORE UPDATE OR DELETE ON repository_manual_approval_events
FOR EACH ROW EXECUTE FUNCTION reject_repository_approval_mutation();
