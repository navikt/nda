-- Database schema for Deployment Audit Application
-- Application-centric model with repository validation

-- Monitored applications (primary entity)
CREATE TABLE IF NOT EXISTS monitored_applications (
  id SERIAL PRIMARY KEY,
  team_slug VARCHAR(255) NOT NULL,
  environment_name VARCHAR(255) NOT NULL,
  app_name VARCHAR(255) NOT NULL,
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  default_branch VARCHAR(255),
  audit_start_year INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(team_slug, environment_name, app_name)
);

CREATE INDEX IF NOT EXISTS idx_monitored_apps_team ON monitored_applications(team_slug);
CREATE INDEX IF NOT EXISTS idx_monitored_apps_active ON monitored_applications(is_active);

-- Application repositories (many-to-one with monitored_applications)
-- Handles repository changes over time (renames, migrations, monorepo moves)
CREATE TABLE IF NOT EXISTS application_repositories (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  
  -- Repository identity
  github_owner VARCHAR(255) NOT NULL DEFAULT 'navikt',
  github_repo_name VARCHAR(255) NOT NULL,
  
  -- Status: 'active' (current), 'historical' (old but valid), 'pending_approval' (needs review)
  status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
  
  -- Repository redirect (for renamed repos)
  -- If set, this repo name redirects to another name
  -- Example: old name 'pensjon-old' redirects to new name 'pensjon-new'
  redirects_to_owner VARCHAR(255),
  redirects_to_repo VARCHAR(255),
  
  -- Metadata
  notes TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(monitored_app_id, github_owner, github_repo_name)
);

CREATE INDEX IF NOT EXISTS idx_app_repos_app ON application_repositories(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_app_repos_status ON application_repositories(status);
CREATE INDEX IF NOT EXISTS idx_app_repos_repo ON application_repositories(github_owner, github_repo_name);


-- Deployments from Nais
CREATE TABLE IF NOT EXISTS deployments (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  
  -- Nais deployment data
  nais_deployment_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  deployer_username VARCHAR(255), -- Nullable: not always provided by Nais API
  commit_sha VARCHAR(40), -- Nullable: not always provided by Nais API
  trigger_url TEXT,
  
  -- Detected repository (may differ from approved!)
  detected_github_owner VARCHAR(255) NOT NULL,
  detected_github_repo_name VARCHAR(255) NOT NULL,
  
  -- Four-eyes status
  four_eyes_status VARCHAR(50) DEFAULT 'unknown',
  
  github_pr_number INTEGER,
  github_pr_url TEXT,
  
  -- PR metadata (JSONB for flexibility)
  github_pr_data JSONB,
  -- Structure: {
  --   title: string,
  --   body: string,
  --   labels: string[],
  --   created_at: string,
  --   merged_at: string,
  --   base_branch: string,
  --   base_sha: string,
  --   commits_count: number,
  --   changed_files: number,
  --   additions: number,
  --   deletions: number,
  --   draft: boolean,
  --   creator: { username: string, avatar_url: string },
  --   merger: { username: string, avatar_url: string },
  --   reviewers: [{ username: string, avatar_url: string, state: string, submitted_at: string }],
  --   checks_passed: boolean,
  --   checks: [{ name: string, status: string, conclusion: string, started_at: string, completed_at: string, html_url: string }],
  --   commits: [{ sha: string, message: string, author: { username: string, avatar_url: string }, committer: { username: string, avatar_url: string }, html_url: string }],
  --   unreviewed_commits?: [{ sha: string, message: string, author: string, date: string, html_url: string, reason: string }]
  -- }
  
  -- Branch and merge information
  branch_name VARCHAR(255), -- Branch that was deployed (from GitHub Actions workflow)
  parent_commits JSONB, -- Parent commit SHAs for merge commits: [{ sha: string }, ...]
  
  -- Kubernetes resources (JSONB for flexibility)
  resources JSONB,
  
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_monitored_app ON deployments(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_commit_sha ON deployments(commit_sha);
CREATE INDEX IF NOT EXISTS idx_deployments_four_eyes_status ON deployments(four_eyes_status);
CREATE INDEX IF NOT EXISTS idx_deployments_detected_repo ON deployments(detected_github_owner, detected_github_repo_name);

-- Repository mismatch alerts
CREATE TABLE IF NOT EXISTS repository_alerts (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  
  -- Note: the column default ('repository_changed') differs from the application
  -- fallback in createRepositoryAlert ('repository_mismatch'). The column default
  -- is unused in practice — the application always supplies alert_type explicitly.
  alert_type VARCHAR(50) NOT NULL DEFAULT 'repository_changed',
  -- Alert types (distinct from deployments.four_eyes_status):
  -- 'repository_mismatch': Deployment from unknown/unapproved repository
  -- 'historical_repository': Deployment from historical (non-active) repository
  -- 'pending_approval': Deployment from repository pending approval
  
  expected_github_owner VARCHAR(255) NOT NULL,
  expected_github_repo_name VARCHAR(255) NOT NULL,
  detected_github_owner VARCHAR(255) NOT NULL,
  detected_github_repo_name VARCHAR(255) NOT NULL,
  
  -- Resolution tracking
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255),
  resolution_note TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_monitored_app ON repository_alerts(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON repository_alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON repository_alerts(created_at);

-- Comments on deployments (including Slack links for direct pushes)
CREATE TABLE IF NOT EXISTS deployment_comments (
  id SERIAL PRIMARY KEY,
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  slack_link TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ NULL,
  deleted_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployment_comments_active
  ON deployment_comments(deployment_id)
  WHERE deleted_at IS NULL;

-- Deployment status history — audit trail of all status transitions
CREATE TABLE IF NOT EXISTS deployment_status_history (
  id SERIAL PRIMARY KEY,
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  changed_by VARCHAR(100),
  change_source VARCHAR(50) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployment_status_history_deployment
  ON deployment_status_history(deployment_id);

CREATE INDEX IF NOT EXISTS idx_deployment_status_history_created
  ON deployment_status_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deployment_status_history_source
  ON deployment_status_history(change_source);

-- Enforce at most one attributed baseline_approval per deployment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_status_history_baseline_approval_unique
  ON deployment_status_history (deployment_id)
  WHERE change_source = 'baseline_approval' AND changed_by IS NOT NULL;

COMMENT ON TABLE deployment_status_history IS 'Audit trail of all deployment status transitions';
COMMENT ON COLUMN deployment_status_history.change_source IS 'Source of change: verification, manual_approval, reverification, sync, legacy, baseline_approval, admin_reset';
COMMENT ON COLUMN deployment_status_history.changed_by IS 'NAV-ident, GitHub username, or system identifier';

-- Commits cache (for fast verification without GitHub API calls)
CREATE TABLE IF NOT EXISTS commits (
  sha TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  author_username TEXT,
  author_date TIMESTAMPTZ,
  committer_date TIMESTAMPTZ,
  message TEXT,
  parent_shas JSONB DEFAULT '[]',
  
  -- PR association (null = direct push to main or not yet determined)
  original_pr_number INT,
  original_pr_title TEXT,
  original_pr_url TEXT,
  
  -- Cached verification result
  pr_approved BOOLEAN,
  pr_approval_reason TEXT,
  
  -- Metadata
  is_merge_commit BOOLEAN DEFAULT false,
  html_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (repo_owner, repo_name, sha)
);

CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_owner, repo_name);
CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(repo_owner, repo_name, committer_date DESC);
CREATE INDEX IF NOT EXISTS idx_commits_pr ON commits(repo_owner, repo_name, original_pr_number);
CREATE INDEX IF NOT EXISTS idx_commits_unverified ON commits(repo_owner, repo_name) 
  WHERE pr_approved IS NULL OR pr_approved = false;

-- Users (NAV-ident as primary key — stable identity across GitHub account changes)
CREATE TABLE IF NOT EXISTS users (
  nav_ident   TEXT PRIMARY KEY CHECK (nav_ident ~ '^[A-Z][0-9]{6}$'),
  display_name TEXT NOT NULL,
  nav_email    TEXT NOT NULL,
  slack_member_id TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ NULL,
  deleted_by   TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_nav_email ON users(nav_email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(nav_ident) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_slack_member_id ON users(slack_member_id) WHERE slack_member_id IS NOT NULL AND deleted_at IS NULL;

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_monitored_apps_updated_at BEFORE UPDATE ON monitored_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS user_github_accounts (
  github_username        TEXT PRIMARY KEY CHECK (github_username = LOWER(github_username)),
  display_github_username TEXT CHECK (
    display_github_username IS NULL OR LOWER(display_github_username) = github_username
  ),
  nav_ident              TEXT NOT NULL REFERENCES users(nav_ident),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ NULL,
  deleted_by             TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_github_accounts_nav_ident
  ON user_github_accounts(nav_ident);

CREATE INDEX IF NOT EXISTS idx_user_github_accounts_active
  ON user_github_accounts(github_username) WHERE deleted_at IS NULL;

-- Audit reports (current state — pdf_data stored in audit_report_files)
CREATE TABLE IF NOT EXISTS audit_reports (
  id SERIAL PRIMARY KEY,
  report_id TEXT UNIQUE NOT NULL,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  team_slug TEXT NOT NULL,
  environment_name TEXT NOT NULL,
  repository TEXT NOT NULL,
  year INTEGER NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'yearly' CONSTRAINT audit_reports_period_type_check CHECK (period_type IN ('yearly', 'tertiary', 'quarterly', 'monthly', 'custom')),
  period_label TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_deployments INTEGER NOT NULL,
  pr_approved_count INTEGER NOT NULL,
  manually_approved_count INTEGER NOT NULL,
  unique_deployers INTEGER NOT NULL,
  unique_reviewers INTEGER NOT NULL,
  report_data JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  change_origin_count INTEGER,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by TEXT,
  generated_by_app TEXT,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archive_reason TEXT,
  restored_at TIMESTAMPTZ,
  restored_by TEXT,
  superseded_at TIMESTAMPTZ,
  superseded_by TEXT,
  supersede_reason TEXT,
  superseded_by_report_id INTEGER REFERENCES audit_reports(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_reports_app ON audit_reports(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_year ON audit_reports(year);
CREATE INDEX IF NOT EXISTS idx_audit_reports_report_id ON audit_reports(report_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_reports_active_period
  ON audit_reports(monitored_app_id, period_type, period_start, period_end)
  WHERE superseded_at IS NULL AND archived_at IS NULL;

-- Audit report file attachments (pdf, xlsx) — child of audit_reports
CREATE TABLE IF NOT EXISTS audit_report_files (
  audit_report_id INTEGER NOT NULL REFERENCES audit_reports(id) ON DELETE CASCADE,
  format          TEXT    NOT NULL CHECK (format IN ('pdf', 'xlsx')),
  data            BYTEA   NOT NULL,
  PRIMARY KEY (audit_report_id, format)
);

-- Async report generation jobs
CREATE TABLE IF NOT EXISTS report_jobs (
  id                 SERIAL PRIMARY KEY,
  job_id             UUID         UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  monitored_app_id   INTEGER      REFERENCES monitored_applications(id) ON DELETE CASCADE,
  year               INTEGER      NOT NULL,
  status             TEXT         NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  period_type        TEXT         NOT NULL DEFAULT 'yearly'
                       CONSTRAINT report_jobs_period_type_check
                       CHECK (period_type IN ('yearly', 'tertiary', 'quarterly', 'monthly', 'custom')),
  period_label       TEXT,
  period_start       DATE,
  period_end         DATE,
  audit_report_id    INTEGER      REFERENCES audit_reports(id),
  pdf_data           BYTEA,
  error              TEXT,
  started_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_jobs_job_id      ON report_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_report_jobs_created_at  ON report_jobs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_jobs_inflight
  ON report_jobs(monitored_app_id, period_type, period_start, period_end)
  WHERE status IN ('pending', 'processing');

