import type { PoolClient } from 'pg'

export async function getRepositoryManualApprovalCommits(
  client: Pick<PoolClient, 'query'>,
  repositoryId: number,
  deliveryIds: number[],
) {
  if (deliveryIds.length === 0) return []
  const { rows } = await client.query<{
    delivery_id: number
    id: number
    snapshot_id: number
    reviewer_nav_ident: string
    registered_by_nav_ident: string
    reviewed_at: Date
    registered_at: Date
    review_documentation: string | null
    sha: string
    author_login: string | null
    author_nav_ident: string | null
    eligible: boolean
    revoked: boolean
  }>(
    `SELECT s.delivery_id, a.id, a.snapshot_id, a.reviewer_nav_ident, a.registered_by_nav_ident,
            a.reviewed_at, a.registered_at, a.review_documentation,
            c.sha, c.author_login, c.author_nav_ident,
            EXISTS (SELECT 1 FROM repository_manual_approval_events e
                    WHERE e.approval_id = a.id AND e.event_type = 'revoked') AS revoked,
            COALESCE(
              uga.deleted_at IS NULL AND u.deleted_at IS NULL
              AND uga.nav_ident = c.author_nav_ident AND u.nav_ident = c.author_nav_ident
              AND uga.identity_version = c.account_identity_version
              AND u.identity_version = c.user_identity_version
              AND a.reviewer_nav_ident <> c.author_nav_ident
              AND lower(d.base_sha) = s.base_sha AND lower(d.head_sha) = s.head_sha
              AND d.repository_id = s.repository_id, false
            ) AS eligible
     FROM repository_manual_approvals a
     JOIN repository_approval_snapshots s ON s.id = a.snapshot_id
     JOIN repository_code_deliveries d ON d.id = s.delivery_id
     JOIN repository_manual_approval_commits ac ON ac.approval_id = a.id
     JOIN repository_approval_snapshot_commits c ON c.snapshot_id = ac.snapshot_id AND c.sha = ac.sha
     LEFT JOIN user_github_accounts uga ON uga.github_username = c.author_login
     LEFT JOIN users u ON u.nav_ident = uga.nav_ident
     WHERE s.repository_id = $1 AND s.delivery_id = ANY($2::int[])
     ORDER BY a.id, c.sha`,
    [repositoryId, deliveryIds],
  )
  return rows.map(({ eligible, revoked, ...row }) => ({
    ...row,
    status: revoked
      ? ('revoked' as const)
      : eligible
        ? ('eligible' as const)
        : ('identity_or_interval_changed' as const),
  }))
}
