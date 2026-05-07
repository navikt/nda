-- Add dependabot_target column to board_objectives and board_key_results
-- Only one objective or key result per board can be marked as the Dependabot target (enforced by application logic)
ALTER TABLE board_objectives ADD COLUMN IF NOT EXISTS dependabot_target BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE board_key_results ADD COLUMN IF NOT EXISTS dependabot_target BOOLEAN NOT NULL DEFAULT false;

-- Update link_method CHECK constraint to include 'dependabot_auto'
ALTER TABLE deployment_goal_links DROP CONSTRAINT IF EXISTS deployment_goal_links_link_method_check;
ALTER TABLE deployment_goal_links ADD CONSTRAINT deployment_goal_links_link_method_check
  CHECK (link_method IN ('manual', 'slack', 'commit_keyword', 'pr_title', 'dependabot_auto'));
