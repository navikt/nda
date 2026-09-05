-- Populate repositories from existing application_repositories rows.
--
-- Merge strategy for applications that already share a GitHub repository:
--   audit_start_year       -> earliest non-null value in the group (MIN skips NULL)
--   implicit_approval_mode -> strictest mode in the group, where the strictness
--                             order is off > dependabot_only > all. Applications
--                             without an app_settings row count as 'off'.
--
-- default_branch is deliberately left NULL here: guessing it from the diverging
-- per-app values would be wrong for exactly the monorepo groups this table is
-- meant to fix. It is instead fetched live from GitHub the next time the
-- periodic default branch sync (app/lib/sync/default-branch-sync.server.ts)
-- runs for an app on this repository, which creates/updates the repositories
-- row automatically. Until then consumers fall back to
-- monitored_applications.default_branch.
--
-- Rows in application_repositories that have no github_repo_id yet get no
-- repositories row; those applications keep using their per-app values until
-- the id is backfilled and the periodic sync runs again.

INSERT INTO repositories (github_repo_id, github_owner, github_repo_name, audit_start_year, implicit_approval_mode)
SELECT
  merged.github_repo_id,
  merged.github_owner,
  merged.github_repo_name,
  merged.audit_start_year,
  CASE merged.strictness
    WHEN 1 THEN 'off'
    WHEN 2 THEN 'dependabot_only'
    ELSE 'all'
  END
FROM (
  SELECT
    active_repo.github_repo_id,
    (array_agg(active_repo.github_owner ORDER BY active_repo.created_at DESC, active_repo.id DESC))[1] AS github_owner,
    (array_agg(active_repo.github_repo_name ORDER BY active_repo.created_at DESC, active_repo.id DESC))[1] AS github_repo_name,
    MIN(ma.audit_start_year) AS audit_start_year,
    MIN(
      CASE COALESCE(s.setting_value ->> 'mode', 'off')
        WHEN 'dependabot_only' THEN 2
        WHEN 'all' THEN 3
        ELSE 1
      END
    ) AS strictness
  FROM (
    SELECT DISTINCT ON (monitored_app_id)
      monitored_app_id, github_owner, github_repo_name, github_repo_id, created_at, id
    FROM application_repositories
    WHERE status = 'active' AND github_repo_id IS NOT NULL
    ORDER BY monitored_app_id, created_at DESC, id DESC
  ) active_repo
  JOIN monitored_applications ma ON ma.id = active_repo.monitored_app_id AND ma.is_active = true
  LEFT JOIN app_settings s
    ON s.monitored_app_id = ma.id AND s.setting_key = 'implicit_approval'
  GROUP BY active_repo.github_repo_id
) merged
ON CONFLICT (github_repo_id) DO NOTHING;
