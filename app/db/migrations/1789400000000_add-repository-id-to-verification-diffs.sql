-- Migration: Add nullable repository_id to verification_diffs
-- Deferred from the original Steg 1 schema work until repo-scoped read pages (Steg 3a)
-- existed, so the semantics (which repository, if the app has multiple links) could be
-- designed alongside the actual consumer. Populated going forward by computeVerificationDiffs;
-- existing rows stay NULL until the next reverify job recomputes them for their app.

ALTER TABLE verification_diffs ADD COLUMN repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL;

CREATE INDEX idx_verification_diffs_repository ON verification_diffs(repository_id);
