import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { UserIdentity } from '~/lib/auth.server'
import { canAccessRepositoryAdminWithClient, resolveRepositoryApprovalCapabilities } from '~/lib/authorization.server'
import { isFullCommitSha } from '~/lib/git-constants'
import type { assessRepositoryDeliveryInterval } from '~/lib/repository-code-delivery/interval-assessment'
import { withTransaction } from './connection.server'
import { getRepositoryCodeDeliveryIntervalAssessments } from './repository-code-delivery-interval-assessment.server'

type Evidence = Parameters<typeof assessRepositoryDeliveryInterval>[0]

interface Snapshot {
  id: number
  delivery_id: number
  repository_id: number
  base_sha: string
  head_sha: string
  schema_version: number
  evaluator_version: number
  evidence: Evidence
  evidence_hash: string
  created_at: Date
}

interface AuthorIdentity {
  author_login: string
  author_nav_ident: string
  account_identity_version: string
  user_identity_version: string
}

export class RepositoryApprovalError extends Error {
  constructor(
    readonly code: 'forbidden' | 'not_found' | 'stale_ground' | 'incomplete_evidence' | 'invalid_approval',
    message: string,
  ) {
    super(message)
    this.name = 'RepositoryApprovalError'
  }
}

function evidenceHash(evidence: Evidence): string {
  const serialized = JSON.stringify(evidence, (_key, value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : value,
  )
  return createHash('sha256').update(serialized).digest('hex')
}

async function withApprovalTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(operation)
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === '40001' || error.code === '40P01')) {
      throw new RepositoryApprovalError(
        'stale_ground',
        'The approval ground changed concurrently; reload before approving',
      )
    }
    throw error
  }
}

async function requireApprovalAccess(client: PoolClient, actor: UserIdentity, repositoryId: number): Promise<void> {
  const { canApprove } = await resolveRepositoryApprovalCapabilities(actor, repositoryId, client)
  if (!canApprove) throw new RepositoryApprovalError('forbidden', 'Repository approval access required')
}

async function currentGround(client: PoolClient, repositoryId: number, deliveryId: number) {
  const { rows } = await client.query<{ id: number; base_sha: string; head_sha: string }>(
    `SELECT id, base_sha, head_sha FROM repository_code_deliveries
     WHERE repository_id = $1 AND id = $2 FOR SHARE`,
    [repositoryId, deliveryId],
  )
  const delivery = rows[0]
  if (!delivery) throw new RepositoryApprovalError('not_found', 'Code delivery not found')
  const [ground] = await getRepositoryCodeDeliveryIntervalAssessments(repositoryId, [delivery], client)
  const shas = ground.assessment.commits.map((commit) => commit.sha.toLowerCase())
  if (
    !ground.assessment.comparisonComplete ||
    !isFullCommitSha(delivery.base_sha) ||
    !isFullCommitSha(delivery.head_sha) ||
    shas.some((sha) => !isFullCommitSha(sha)) ||
    shas.length === 0 ||
    ground.assessment.totalCommits !== shas.length ||
    new Set(shas).size !== shas.length ||
    !shas.includes(delivery.head_sha.toLowerCase()) ||
    shas.includes(delivery.base_sha.toLowerCase())
  ) {
    throw new RepositoryApprovalError('incomplete_evidence', 'A complete non-empty delivery interval is required')
  }
  return { delivery, ...ground }
}

async function lockAuthorIdentities(client: PoolClient, logins: string[]): Promise<Map<string, AuthorIdentity>> {
  if (logins.length === 0) return new Map()
  const normalizedLogins = [...new Set(logins.map((login) => login.toLowerCase()))]
  await client.query(
    `SELECT u.nav_ident FROM users u
     WHERE u.deleted_at IS NULL AND u.nav_ident IN (
       SELECT nav_ident FROM user_github_accounts
       WHERE github_username = ANY($1::text[]) AND deleted_at IS NULL
     )
     ORDER BY u.nav_ident FOR SHARE OF u`,
    [normalizedLogins],
  )
  const { rows } = await client.query<AuthorIdentity>(
    `SELECT uga.github_username AS author_login, u.nav_ident AS author_nav_ident,
            uga.identity_version::text AS account_identity_version,
            u.identity_version::text AS user_identity_version
     FROM user_github_accounts uga
     JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE uga.github_username = ANY($1::text[]) AND uga.deleted_at IS NULL
     ORDER BY uga.github_username
     FOR SHARE OF uga`,
    [normalizedLogins],
  )
  return new Map(rows.map((row) => [row.author_login, row]))
}

export async function createRepositoryApprovalSnapshot(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
): Promise<Snapshot> {
  return withApprovalTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await requireApprovalAccess(client, actor, repositoryId)
    const ground = await currentGround(client, repositoryId, deliveryId)
    const identities = await lockAuthorIdentities(
      client,
      ground.assessment.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
    )
    const { rows } = await client.query<Snapshot>(
      `INSERT INTO repository_approval_snapshots
         (delivery_id, repository_id, base_sha, head_sha, schema_version, evaluator_version, evidence, evidence_hash)
       VALUES ($1, $2, lower($3), lower($4), 1, 1, $5::jsonb, $6) RETURNING *`,
      [
        deliveryId,
        repositoryId,
        ground.delivery.base_sha,
        ground.delivery.head_sha,
        JSON.stringify(ground.evidence),
        evidenceHash(ground.evidence),
      ],
    )
    const snapshot = rows[0]
    for (const commit of ground.assessment.commits) {
      const identity = commit.authorLogin ? identities.get(commit.authorLogin.toLowerCase()) : undefined
      await client.query(
        `INSERT INTO repository_approval_snapshot_commits
           (snapshot_id, sha, author_login, author_nav_ident, account_identity_version, user_identity_version)
         VALUES ($1, lower($2), $3, $4, $5, $6)`,
        [
          snapshot.id,
          commit.sha,
          commit.authorLogin?.toLowerCase() ?? null,
          identity?.author_nav_ident ?? null,
          identity?.account_identity_version ?? null,
          identity?.user_identity_version ?? null,
        ],
      )
    }
    return snapshot
  })
}

async function getSnapshot(client: PoolClient, repositoryId: number, deliveryId: number, snapshotId: number) {
  const { rows } = await client.query<Snapshot>(
    `SELECT * FROM repository_approval_snapshots
     WHERE id = $1 AND repository_id = $2 AND delivery_id = $3`,
    [snapshotId, repositoryId, deliveryId],
  )
  if (!rows[0]) throw new RepositoryApprovalError('not_found', 'Approval snapshot not found')
  return rows[0]
}

export async function registerRepositoryManualApproval(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  input: { snapshotId: number; commitShas: string[]; reviewedAt: Date },
): Promise<number> {
  if (
    !/^[A-Z][0-9]{6}$/.test(actor.navIdent) ||
    !Number.isFinite(input.reviewedAt.getTime()) ||
    input.commitShas.length === 0 ||
    input.commitShas.some((sha) => !isFullCommitSha(sha)) ||
    new Set(input.commitShas.map((sha) => sha.toLowerCase())).size !== input.commitShas.length
  ) {
    throw new RepositoryApprovalError('invalid_approval', 'Valid reviewer, review time and unique commits are required')
  }
  return withApprovalTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await requireApprovalAccess(client, actor, repositoryId)
    const snapshot = await getSnapshot(client, repositoryId, deliveryId, input.snapshotId)
    const ground = await currentGround(client, repositoryId, deliveryId)
    if (
      snapshot.schema_version !== 1 ||
      snapshot.evaluator_version !== 1 ||
      snapshot.evidence_hash !== evidenceHash(ground.evidence) ||
      snapshot.base_sha !== ground.delivery.base_sha.toLowerCase() ||
      snapshot.head_sha !== ground.delivery.head_sha.toLowerCase()
    ) {
      throw new RepositoryApprovalError('stale_ground', 'The delivery evidence has changed; reload before approving')
    }
    const { rows: commits } = await client.query<{
      sha: string
      author_login: string | null
      author_nav_ident: string | null
      account_identity_version: string | null
      user_identity_version: string | null
    }>(
      `SELECT sha, author_login, author_nav_ident, account_identity_version::text, user_identity_version::text
       FROM repository_approval_snapshot_commits WHERE snapshot_id = $1 AND sha = ANY($2::text[]) ORDER BY sha`,
      [snapshot.id, input.commitShas.map((sha) => sha.toLowerCase())],
    )
    if (commits.length !== input.commitShas.length) {
      throw new RepositoryApprovalError('invalid_approval', 'Every selected commit must belong to this interval')
    }
    const identities = await lockAuthorIdentities(
      client,
      commits.flatMap((commit) => (commit.author_login ? [commit.author_login] : [])),
    )
    for (const commit of commits) {
      const identity = commit.author_login ? identities.get(commit.author_login) : undefined
      if (
        !identity ||
        identity.author_nav_ident !== commit.author_nav_ident ||
        identity.account_identity_version !== commit.account_identity_version ||
        identity.user_identity_version !== commit.user_identity_version
      ) {
        throw new RepositoryApprovalError(
          'stale_ground',
          'Author identity is missing or has changed; reload before approving',
        )
      }
      if (identity.author_nav_ident === actor.navIdent) {
        throw new RepositoryApprovalError('invalid_approval', 'A reviewer cannot approve their own commits')
      }
      const coverage = ground.assessment.commits.find((candidate) => candidate.sha.toLowerCase() === commit.sha)
      if (!coverage || coverage.status === 'unknown') {
        throw new RepositoryApprovalError('incomplete_evidence', 'Unknown PR evidence cannot receive manual coverage')
      }
    }
    const { rows: times } = await client.query<{ valid: boolean }>(
      'SELECT $1::timestamptz <= clock_timestamp() AS valid',
      [input.reviewedAt],
    )
    if (!times[0].valid) throw new RepositoryApprovalError('invalid_approval', 'Review time cannot be in the future')
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO repository_manual_approvals
         (snapshot_id, reviewer_nav_ident, registered_by_nav_ident, reviewed_at)
       VALUES ($1, $2, $2, $3) RETURNING id`,
      [snapshot.id, actor.navIdent, input.reviewedAt],
    )
    const approvalId = rows[0].id
    await client.query(
      `INSERT INTO repository_manual_approval_commits (approval_id, snapshot_id, sha)
       SELECT $1, $2, unnest($3::text[])`,
      [approvalId, snapshot.id, commits.map((commit) => commit.sha)],
    )
    await client.query(
      `INSERT INTO repository_manual_approval_events (approval_id, event_type, actor_nav_ident)
       VALUES ($1, 'created', $2)`,
      [approvalId, actor.navIdent],
    )
    return approvalId
  })
}

export async function revokeRepositoryManualApproval(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  approvalId: number,
  reason: string,
): Promise<boolean> {
  if (!reason.trim()) throw new RepositoryApprovalError('invalid_approval', 'A revocation reason is required')
  return withTransaction(async (client) => {
    if (!(await canAccessRepositoryAdminWithClient(actor, repositoryId, client))) {
      throw new RepositoryApprovalError('forbidden', 'Repository admin access required')
    }
    const { rows } = await client.query<{ id: number }>(
      `SELECT a.id FROM repository_manual_approvals a
       JOIN repository_approval_snapshots s ON s.id = a.snapshot_id
       WHERE a.id = $1 AND s.repository_id = $2 AND s.delivery_id = $3`,
      [approvalId, repositoryId, deliveryId],
    )
    if (!rows[0]) throw new RepositoryApprovalError('not_found', 'Approval not found')
    const result = await client.query(
      `INSERT INTO repository_manual_approval_events (approval_id, event_type, actor_nav_ident, reason)
       VALUES ($1, 'revoked', $2, $3) ON CONFLICT (approval_id, event_type) DO NOTHING`,
      [approvalId, actor.navIdent, reason.trim()],
    )
    return (result.rowCount ?? 0) > 0
  })
}

export async function getRepositoryManualApprovalHistory(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
) {
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await requireApprovalAccess(client, actor, repositoryId)
    const { rows } = await client.query<{
      id: number
      snapshot_id: number
      reviewer_nav_ident: string
      registered_by_nav_ident: string
      reviewed_at: Date
      registered_at: Date
      sha: string
      author_login: string | null
      author_nav_ident: string | null
      eligible: boolean
      revoked: boolean
    }>(
      `SELECT a.id, a.snapshot_id, a.reviewer_nav_ident, a.registered_by_nav_ident, a.reviewed_at, a.registered_at,
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
       WHERE s.repository_id = $1 AND s.delivery_id = $2
       ORDER BY a.id, c.sha`,
      [repositoryId, deliveryId],
    )
    const { rows: events } = await client.query<{
      id: number
      approval_id: number
      event_type: 'created' | 'revoked'
      actor_nav_ident: string
      reason: string | null
      created_at: Date
    }>(
      `SELECT e.* FROM repository_manual_approval_events e
       JOIN repository_manual_approvals a ON a.id = e.approval_id
       JOIN repository_approval_snapshots s ON s.id = a.snapshot_id
       WHERE s.repository_id = $1 AND s.delivery_id = $2 ORDER BY e.id`,
      [repositoryId, deliveryId],
    )
    const { rows: snapshots } = await client.query<Snapshot>(
      `SELECT * FROM repository_approval_snapshots
       WHERE repository_id = $1 AND delivery_id = $2 ORDER BY id`,
      [repositoryId, deliveryId],
    )
    return {
      snapshots,
      commits: rows.map(({ eligible, revoked, ...row }) => ({
        ...row,
        status: revoked
          ? ('revoked' as const)
          : eligible
            ? ('eligible' as const)
            : ('identity_or_interval_changed' as const),
      })),
      events,
    }
  })
}
