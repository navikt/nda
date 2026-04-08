-- Add keywords column to board_objectives and board_key_results
-- Keywords are used for automatic deployment-goal linking via commit messages
ALTER TABLE board_objectives ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';
ALTER TABLE board_key_results ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';
