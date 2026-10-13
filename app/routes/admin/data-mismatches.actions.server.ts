import { pool } from '~/db/connection.server'
import { effectiveAuditStartYearSql } from '~/db/repository-settings-sql'
import { requireAdmin } from '~/lib/auth.server'
import { LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'
import type { Route } from './+types/data-mismatches'

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'fix_mismatches') {
    const result = await pool.query(
      `UPDATE deployments
       SET title = LEFT(BTRIM(github_pr_data->>'title', E' \t\r\n'), 500)
       WHERE COALESCE(BTRIM(github_pr_data->>'title', E' \t\r\n'), '') != ''
         AND title IS NOT NULL
         AND title != LEFT(BTRIM(github_pr_data->>'title', E' \t\r\n'), 500)`,
    )
    const count = result.rowCount ?? 0
    return { success: `Korrigerte ${count} feil titler.` }
  }

  if (intent === 'fix_missing') {
    const result = await pool.query(
      `UPDATE deployments d
       SET title = LEFT(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), 500)
       FROM monitored_applications ma
       WHERE d.monitored_app_id = ma.id
         AND d.title IS NULL
         AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') != ''
         AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})
         AND d.created_at >= make_date(${effectiveAuditStartYearSql('ma')}, 1, 1)`,
    )
    const count = result.rowCount ?? 0
    return { success: `Fylte inn ${count} manglende titler fra PR-data.` }
  }

  if (intent === 'backfill_from_cache') {
    const result = await pool.query(
      `WITH candidate_deployments AS (
         SELECT d.id, d.commit_sha, d.detected_github_owner, d.detected_github_repo_name, d.monitored_app_id
         FROM deployments d
         JOIN monitored_applications ma ON d.monitored_app_id = ma.id
         WHERE d.title IS NULL
           AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \t\r\n'), '') = ''
           AND (d.unverified_commits IS NULL OR jsonb_array_length(d.unverified_commits) = 0
               OR COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\n', 1), E' \t\r\n'), '') = '')
           AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${LEGACY_STATUSES_SQL})
           AND d.created_at >= make_date(${effectiveAuditStartYearSql('ma')}, 1, 1)
           AND d.detected_github_owner IS NOT NULL
           AND d.detected_github_repo_name IS NOT NULL
       ),
       latest_snapshots AS (
         SELECT DISTINCT ON (cd.id)
           cd.id AS deployment_id,
           BTRIM(
             SPLIT_PART(cmp.data->'commits'->0->>'message', E'\n', 1),
             E' \t\r\n'
           ) AS derived_title
         FROM candidate_deployments cd
         JOIN github_compare_snapshots cmp
           ON cmp.owner = cd.detected_github_owner
           AND cmp.repo = cd.detected_github_repo_name
           AND cmp.head_sha = cd.commit_sha
         LEFT JOIN LATERAL (
           SELECT ar.github_repo_id
           FROM application_repositories ar
           WHERE ar.monitored_app_id = cd.monitored_app_id
             AND ar.github_owner = cd.detected_github_owner
             AND ar.github_repo_name = cd.detected_github_repo_name
         ) matched_repo ON true
         WHERE (matched_repo.github_repo_id IS NULL OR cmp.github_repo_id IS NULL OR cmp.github_repo_id = matched_repo.github_repo_id)
           AND jsonb_typeof(cmp.data->'commits') = 'array'
           AND jsonb_array_length(cmp.data->'commits') > 0
           AND BTRIM(SPLIT_PART(cmp.data->'commits'->0->>'message', E'\n', 1), E' \t\r\n') != ''
         ORDER BY cd.id, cmp.fetched_at DESC
      )
      UPDATE deployments d
      SET title = LEFT(ls.derived_title, 500)
      FROM latest_snapshots ls
      WHERE d.id = ls.deployment_id`,
    )
    const count = result.rowCount ?? 0
    return {
      success:
        count > 0
          ? `Fylte inn ${count} titler fra compare-cache. Kjør igjen for å se om det gjenstår flere.`
          : 'Ingen titler å fylle inn fra compare-cache. Alle som kan fylles er allerede satt.',
    }
  }

  return { error: 'Ukjent handling' }
}
