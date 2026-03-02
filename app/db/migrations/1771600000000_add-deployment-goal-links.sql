-- Deployment goal links (deployment ↔ objective/key result or external URL)
CREATE TABLE IF NOT EXISTS deployment_goal_links (
  id SERIAL PRIMARY KEY,
  deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  objective_id INTEGER REFERENCES board_objectives(id) ON DELETE SET NULL,
  key_result_id INTEGER REFERENCES board_key_results(id) ON DELETE SET NULL,
  external_url TEXT,
  external_url_title TEXT,
  link_method TEXT NOT NULL CHECK (link_method IN ('manual', 'slack', 'commit_keyword', 'pr_title')),
  linked_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    objective_id IS NOT NULL OR key_result_id IS NOT NULL OR external_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_deployment_goal_links_deployment ON deployment_goal_links(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_goal_links_objective ON deployment_goal_links(objective_id);
CREATE INDEX IF NOT EXISTS idx_deployment_goal_links_key_result ON deployment_goal_links(key_result_id);
