ALTER TABLE repository_approval_snapshots
  ADD COLUMN created_by_nav_ident TEXT
    CHECK (created_by_nav_ident IS NULL OR created_by_nav_ident ~ '^[A-Z][0-9]{6}$');

ALTER TABLE repository_manual_approvals
  ADD COLUMN review_documentation TEXT,
  ADD COLUMN documentation_url TEXT,
  ADD CONSTRAINT repository_approval_documentation_not_blank
    CHECK (review_documentation IS NULL OR length(trim(review_documentation)) > 0),
  ADD CONSTRAINT repository_approval_documentation_url_http
    CHECK (documentation_url IS NULL OR documentation_url ~* '^https?://');
