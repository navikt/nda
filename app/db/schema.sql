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
  default_branch VARCHAR(255) DEFAULT 'main',
  audit_start_year INTEGER DEFAULT 2025,
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
  
  alert_type VARCHAR(50) NOT NULL DEFAULT 'repository_changed',
  -- Alert types:
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployment_comments_deployment_id ON deployment_comments(deployment_id);

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

-- User mappings (GitHub username to Nav identity and Slack)
CREATE TABLE IF NOT EXISTS user_mappings (
  github_username TEXT PRIMARY KEY,
  display_name TEXT,
  nav_email TEXT,
  nav_ident TEXT,
  slack_member_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mappings_slack ON user_mappings(slack_member_id);
CREATE INDEX IF NOT EXISTS idx_user_mappings_email ON user_mappings(nav_email);

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
