import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { UserIdentity } from '~/lib/auth.server'
import { canAccessRepositoryAdminWithClient, resolveRepositoryApprovalCapabilities } from '~/lib/authorization.server'
import { isFullCommitSha } from '~/lib/git-constants'
import { presentRepositoryApprovalHistory } from '~/lib/repository-approval-history.server'
import { assessRepositoryDeliveryInterval } from '~/lib/repository-code-delivery/interval-assessment'
import {
  isRepositoryApprovalId,
  parseReviewTime,
  type RepositoryApprovalPreview,
  type RepositoryApprovalReview,
} from '~/lib/repository-manual-approval'
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
  created_by_nav_ident: string | null
}

interface AuthorIdentity {
  author_login: string
  author_nav_ident: string
  account_identity_version: string
  user_identity_version: string
}

export class RepositoryApprovalError extends Error {
  constructor(
    readonly code:
      | 'forbidden'
      | 'not_found'
      | 'stale_ground'
      | 'incomplete_evidence'
      | 'invalid_approval'
      | 'commit_outside_snapshot'
      | 'no_approvable_commits',
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

function approvalGroundHash(evidence: Evidence, identities: Map<string, AuthorIdentity>): string {
  const authors = (evidence.compare?.commits ?? [])
    .map((commit) => {
      const login = commit.authorLogin?.toLowerCase() ?? null
      const identity = login ? identities.get(login) : undefined
      return {
        sha: commit.sha.toLowerCase(),
        login,
        navIdent: identity?.author_nav_ident ?? null,
        accountVersion: identity?.account_identity_version ?? null,
        userVersion: identity?.user_identity_version ?? null,
      }
    })
    .sort((left, right) => (left.sha < right.sha ? -1 : left.sha > right.sha ? 1 : 0))
  return createHash('sha256')
    .update(`${evidenceHash(evidence)}:${JSON.stringify(authors)}`)
    .digest('hex')
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

function requireValidIds(...ids: number[]) {
  if (ids.some((id) => !isRepositoryApprovalId(id))) {
    throw new RepositoryApprovalError('invalid_approval', 'ID-er må være positive heltall.')
  }
}

async function currentGround(client: PoolClient, repositoryId: number, deliveryId: number, lock = true) {
  const { rows } = await client.query<{ id: number; base_sha: string; head_sha: string }>(
    `SELECT id, base_sha, head_sha FROM repository_code_deliveries
     WHERE repository_id = $1 AND id = $2 ${lock ? 'FOR SHARE' : ''}`,
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

async function readAuthorIdentities(client: PoolClient, logins: string[]): Promise<Map<string, AuthorIdentity>> {
  if (logins.length === 0) return new Map()
  const normalizedLogins = [...new Set(logins.map((login) => login.toLowerCase()))]
  const { rows } = await client.query<AuthorIdentity>(
    `SELECT uga.github_username AS author_login, u.nav_ident AS author_nav_ident,
            uga.identity_version::text AS account_identity_version,
            u.identity_version::text AS user_identity_version
     FROM user_github_accounts uga
     JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE lower(uga.github_username) = ANY($1::text[]) AND uga.deleted_at IS NULL
     ORDER BY uga.github_username`,
    [normalizedLogins],
  )
  return new Map(rows.map((row) => [row.author_login.toLowerCase(), row]))
}

function presentApprovalReview(
  actor: UserIdentity,
  baseSha: string,
  headSha: string,
  evidence: Evidence,
  identities: Map<string, AuthorIdentity>,
  manuallyCoveredShas = new Set<string>(),
  previewHash?: string,
  createdAt?: Date,
  snapshotId?: number,
): RepositoryApprovalPreview & Partial<Pick<RepositoryApprovalReview, 'snapshotId' | 'createdAt' | 'reviewer'>> {
  const assessment = assessRepositoryDeliveryInterval(evidence)
  return {
    ...(snapshotId === undefined ? {} : { snapshotId }),
    baseSha,
    headSha,
    ...(createdAt === undefined ? {} : { createdAt: createdAt.toISOString() }),
    reviewer: actor.navIdent,
    previewToken: previewHash ?? evidenceHash(evidence),
    defaultBranch: evidence.defaultBranch,
    implicitApprovalMode: evidence.implicitApprovalMode,
    commits: assessment.commits.map((commit) => {
      const source = evidence.compare?.commits.find((candidate) => candidate.sha === commit.sha)
      const identity = commit.authorLogin ? identities.get(commit.authorLogin.toLowerCase()) : undefined
      return {
        sha: commit.sha,
        message: commit.message,
        authorLogin: commit.authorLogin,
        authorNavIdent: identity?.author_nav_ident ?? null,
        authorDate: source?.authorDate ?? '',
        committerDate: source?.committerDate ?? '',
        prStatus: commit.status,
        prReason: commit.reason,
        pullRequestNumber: commit.pullRequestNumber,
        associations: evidence.associatedPullRequestsByCommit[commit.sha] ?? null,
        unavailableReason:
          commit.status === 'covered'
            ? 'Denne committen er allerede dekket av PR-review.'
            : commit.status === 'unknown'
              ? 'PR-grunnlaget er ukjent.'
              : manuallyCoveredShas.has(commit.sha.toLowerCase())
                ? 'Denne committen er allerede godkjent manuelt.'
                : !identity
                  ? 'Forfatteren mangler en aktiv kobling til NAV-ident.'
                  : identity.author_nav_ident === actor.navIdent
                    ? 'Du kan ikke godkjenne dine egne commits.'
                    : null,
      }
    }),
    pullRequests: Object.values(evidence.pullRequestsByNumber).flatMap((pr) =>
      pr
        ? [
            {
              number: pr.number,
              headSha: pr.headSha,
              baseBranch: pr.baseBranch,
              authorLogin: pr.authorLogin,
              mergedByLogin: pr.mergedByLogin,
              mergeCommitSha: pr.mergeCommitSha,
              commitCount: pr.commitCount,
              commits: (pr.commits ?? []).map((commit) => ({
                sha: commit.sha,
                authorLogin: commit.authorLogin ?? null,
                authorDate: commit.authorDate,
                committerDate: commit.committerDate,
              })),
              reviews: (pr.reviews ?? []).map((review) => ({
                username: review.username,
                state: review.state,
                submittedAt: review.submittedAt,
                commitSha: review.commitId ?? null,
              })),
            },
          ]
        : [],
    ),
  }
}

async function getRepositoryApprovalPreview(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  client: PoolClient,
  manuallyCoveredShas: Set<string>,
): Promise<RepositoryApprovalPreview> {
  await requireApprovalAccess(client, actor, repositoryId)
  const ground = await currentGround(client, repositoryId, deliveryId, false)
  const identities = await readAuthorIdentities(
    client,
    ground.assessment.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
  )
  return presentApprovalReview(
    actor,
    ground.delivery.base_sha,
    ground.delivery.head_sha,
    ground.evidence,
    identities,
    manuallyCoveredShas,
    approvalGroundHash(ground.evidence, identities),
  )
}

export async function createRepositoryApprovalSnapshot(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
): Promise<Snapshot> {
  return createApprovalSnapshot(actor, repositoryId, deliveryId, (snapshot) => snapshot)
}

export async function createRepositoryApprovalReview(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
): Promise<RepositoryApprovalReview> {
  return createApprovalSnapshot(actor, repositoryId, deliveryId, (snapshot, identities) => {
    const assessment = assessRepositoryDeliveryInterval(snapshot.evidence)
    return {
      snapshotId: snapshot.id,
      baseSha: snapshot.base_sha,
      headSha: snapshot.head_sha,
      createdAt: snapshot.created_at.toISOString(),
      reviewer: actor.navIdent,
      previewToken: approvalGroundHash(snapshot.evidence, identities),
      defaultBranch: snapshot.evidence.defaultBranch,
      implicitApprovalMode: snapshot.evidence.implicitApprovalMode,
      commits: assessment.commits.map((commit) => {
        const source = snapshot.evidence.compare?.commits.find((candidate) => candidate.sha === commit.sha)
        const identity = commit.authorLogin ? identities.get(commit.authorLogin.toLowerCase()) : undefined
        return {
          sha: commit.sha,
          message: commit.message,
          authorLogin: commit.authorLogin,
          authorNavIdent: identity?.author_nav_ident ?? null,
          authorDate: source?.authorDate ?? '',
          committerDate: source?.committerDate ?? '',
          prStatus: commit.status,
          prReason: commit.reason,
          pullRequestNumber: commit.pullRequestNumber,
          associations: snapshot.evidence.associatedPullRequestsByCommit[commit.sha] ?? null,
          unavailableReason:
            commit.status === 'covered'
              ? 'Denne committen er allerede dekket av PR-review.'
              : commit.status === 'unknown'
                ? 'PR-grunnlaget er ukjent.'
                : !identity
                  ? 'Forfatteren mangler en aktiv kobling til NAV-ident.'
                  : identity.author_nav_ident === actor.navIdent
                    ? 'Du kan ikke godkjenne dine egne commits.'
                    : !source || !parseReviewTime(source.committerDate)
                      ? 'Lagret committer-tid mangler eller er ugyldig. Ingen alternativ tid brukes.'
                      : null,
        }
      }),
      pullRequests: Object.values(snapshot.evidence.pullRequestsByNumber).flatMap((pr) =>
        pr
          ? [
              {
                number: pr.number,
                headSha: pr.headSha,
                baseBranch: pr.baseBranch,
                authorLogin: pr.authorLogin,
                mergedByLogin: pr.mergedByLogin,
                mergeCommitSha: pr.mergeCommitSha,
                commitCount: pr.commitCount,
                commits: (pr.commits ?? []).map((commit) => ({
                  sha: commit.sha,
                  authorLogin: commit.authorLogin ?? null,
                  authorDate: commit.authorDate,
                  committerDate: commit.committerDate,
                })),
                reviews: (pr.reviews ?? []).map((review) => ({
                  username: review.username,
                  state: review.state,
                  submittedAt: review.submittedAt,
                  commitSha: review.commitId ?? null,
                })),
              },
            ]
          : [],
      ),
    }
  })
}

async function createApprovalSnapshot<T>(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  present: (snapshot: Snapshot, identities: Map<string, AuthorIdentity>) => T,
): Promise<T> {
  requireValidIds(repositoryId, deliveryId)
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
         (delivery_id, repository_id, base_sha, head_sha, schema_version, evaluator_version, evidence, evidence_hash, created_by_nav_ident)
       VALUES ($1, $2, lower($3), lower($4), 1, 1, $5::jsonb, $6, $7) RETURNING *`,
      [
        deliveryId,
        repositoryId,
        ground.delivery.base_sha,
        ground.delivery.head_sha,
        JSON.stringify(ground.evidence),
        evidenceHash(ground.evidence),
        actor.navIdent,
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
    return present(snapshot, identities)
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
  input: {
    snapshotId: number
    commitShas: string[]
    reviewedAt: Date
    reviewDocumentation: string
  },
): Promise<number> {
  requireValidIds(repositoryId, deliveryId, input.snapshotId)
  if (
    !/^[A-Z][0-9]{6}$/.test(actor.navIdent) ||
    !Number.isFinite(input.reviewedAt.getTime()) ||
    input.commitShas.length === 0 ||
    input.commitShas.some((sha) => !isFullCommitSha(sha)) ||
    new Set(input.commitShas.map((sha) => sha.toLowerCase())).size !== input.commitShas.length ||
    typeof input.reviewDocumentation !== 'string' ||
    !input.reviewDocumentation.trim()
  ) {
    throw new RepositoryApprovalError('invalid_approval', 'Valid reviewer, review time and unique commits are required')
  }
  return withApprovalTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await requireApprovalAccess(client, actor, repositoryId)
    const snapshot = await getSnapshot(client, repositoryId, deliveryId, input.snapshotId)
    const ground = await currentGround(client, repositoryId, deliveryId)
    if (
      snapshot.created_by_nav_ident !== actor.navIdent ||
      snapshot.schema_version !== 1 ||
      snapshot.evaluator_version !== 1 ||
      snapshot.evidence_hash !== evidenceHash(ground.evidence) ||
      snapshot.base_sha !== ground.delivery.base_sha.toLowerCase() ||
      snapshot.head_sha !== ground.delivery.head_sha.toLowerCase()
    ) {
      throw new RepositoryApprovalError('stale_ground', 'The delivery evidence has changed; reload before approving')
    }
    const { rows: snapshotCommits } = await client.query<{
      sha: string
      author_login: string | null
      author_nav_ident: string | null
      account_identity_version: string | null
      user_identity_version: string | null
    }>(
      `SELECT sha, author_login, author_nav_ident, account_identity_version::text, user_identity_version::text
       FROM repository_approval_snapshot_commits WHERE snapshot_id = $1 ORDER BY sha`,
      [snapshot.id],
    )
    const selectedShas = new Set(input.commitShas.map((sha) => sha.toLowerCase()))
    const commits = snapshotCommits.filter((commit) => selectedShas.has(commit.sha))
    if (commits.length !== input.commitShas.length) {
      throw new RepositoryApprovalError('commit_outside_snapshot', 'Every selected commit must belong to this interval')
    }
    const identities = await lockAuthorIdentities(
      client,
      snapshotCommits.flatMap((commit) => (commit.author_login ? [commit.author_login] : [])),
    )
    for (const commit of snapshotCommits) {
      const identity = commit.author_login ? identities.get(commit.author_login) : undefined
      if (
        (identity?.author_nav_ident ?? null) !== commit.author_nav_ident ||
        (identity?.account_identity_version ?? null) !== commit.account_identity_version ||
        (identity?.user_identity_version ?? null) !== commit.user_identity_version
      ) {
        throw new RepositoryApprovalError(
          'stale_ground',
          'Author identity is missing or has changed; reload before approving',
        )
      }
    }
    for (const commit of commits) {
      const identity = commit.author_login ? identities.get(commit.author_login) : undefined
      if (!identity) throw new RepositoryApprovalError('stale_ground', 'Author identity is missing')
      if (identity.author_nav_ident === actor.navIdent) {
        throw new RepositoryApprovalError('invalid_approval', 'A reviewer cannot approve their own commits')
      }
      const coverage = ground.assessment.commits.find((candidate) => candidate.sha.toLowerCase() === commit.sha)
      if (!coverage || coverage.status === 'unknown') {
        throw new RepositoryApprovalError('incomplete_evidence', 'Unknown PR evidence cannot receive manual coverage')
      }
      if (coverage.status === 'covered') {
        throw new RepositoryApprovalError('invalid_approval', 'PR-covered commits cannot receive manual approval')
      }
      const source = snapshot.evidence.compare?.commits.find((candidate) => candidate.sha.toLowerCase() === commit.sha)
      const commitTime = source ? parseReviewTime(source.committerDate) : null
      if (!commitTime) {
        throw new RepositoryApprovalError(
          'incomplete_evidence',
          'Lagret committer-tid mangler eller er ugyldig for en valgt commit. Ingen alternativ tid brukes.',
        )
      }
      if (input.reviewedAt < commitTime) {
        throw new RepositoryApprovalError(
          'invalid_approval',
          'Gjennomgangen kan ikke være før den nyeste valgte committens lagrede committer-tid.',
        )
      }
    }
    const { rows: times } = await client.query<{ valid: boolean }>(
      'SELECT $1::timestamptz <= clock_timestamp() AS valid',
      [input.reviewedAt],
    )
    if (!times[0].valid) throw new RepositoryApprovalError('invalid_approval', 'Review time cannot be in the future')
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO repository_manual_approvals
         (snapshot_id, reviewer_nav_ident, registered_by_nav_ident, reviewed_at, review_documentation)
       VALUES ($1, $2, $2, $3, $4) RETURNING id`,
      [snapshot.id, actor.navIdent, input.reviewedAt, input.reviewDocumentation.trim()],
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

export async function approveRepositoryDelivery(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  input: { previewToken: string; note: string | null },
): Promise<{ approvalId: number; commitShas: string[] }> {
  requireValidIds(repositoryId, deliveryId)
  if (
    !/^[A-Z][0-9]{6}$/.test(actor.navIdent) ||
    !/^[a-f0-9]{64}$/.test(input.previewToken) ||
    (input.note !== null && (typeof input.note !== 'string' || input.note.length > 5000))
  ) {
    throw new RepositoryApprovalError('invalid_approval', 'Approval input is invalid')
  }
  return withApprovalTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await requireApprovalAccess(client, actor, repositoryId)
    const ground = await currentGround(client, repositoryId, deliveryId)
    const identities = await lockAuthorIdentities(
      client,
      ground.assessment.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
    )
    if (input.previewToken !== approvalGroundHash(ground.evidence, identities)) {
      throw new RepositoryApprovalError('stale_ground', 'The delivery evidence or author identity has changed')
    }
    const existingHistory = await readRepositoryManualApprovalHistory(
      actor,
      repositoryId,
      deliveryId,
      async () => {},
      readApprovalSnapshotMetadata,
      client,
    )
    const manuallyCoveredShas = new Set(
      existingHistory.commits
        .filter((commit) => commit.status === 'eligible')
        .map((commit) => commit.sha.toLowerCase()),
    )
    const commits = ground.assessment.commits.filter((commit) => {
      if (commit.status !== 'not_covered' || manuallyCoveredShas.has(commit.sha.toLowerCase())) return false
      const identity = commit.authorLogin ? identities.get(commit.authorLogin.toLowerCase()) : undefined
      return identity !== undefined && identity.author_nav_ident !== actor.navIdent
    })
    if (commits.length === 0) {
      throw new RepositoryApprovalError(
        'no_approvable_commits',
        'No commits are missing known PR coverage and eligible for manual approval',
      )
    }
    const { rows: snapshotRows } = await client.query<Snapshot>(
      `INSERT INTO repository_approval_snapshots
         (delivery_id, repository_id, base_sha, head_sha, schema_version, evaluator_version, evidence, evidence_hash, created_by_nav_ident)
       VALUES ($1, $2, lower($3), lower($4), 1, 1, $5::jsonb, $6, $7) RETURNING *`,
      [
        deliveryId,
        repositoryId,
        ground.delivery.base_sha,
        ground.delivery.head_sha,
        JSON.stringify(ground.evidence),
        evidenceHash(ground.evidence),
        actor.navIdent,
      ],
    )
    const snapshot = snapshotRows[0]
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
    const { rows: approvalRows } = await client.query<{ id: number }>(
      `INSERT INTO repository_manual_approvals
         (snapshot_id, reviewer_nav_ident, registered_by_nav_ident, reviewed_at, review_documentation)
       VALUES ($1, $2, $2, transaction_timestamp(), $3) RETURNING id`,
      [snapshot.id, actor.navIdent, input.note?.trim() || null],
    )
    const approvalId = approvalRows[0].id
    const commitShas = commits.map((commit) => commit.sha.toLowerCase())
    await client.query(
      `INSERT INTO repository_manual_approval_commits (approval_id, snapshot_id, sha)
       SELECT $1, $2, unnest($3::text[])`,
      [approvalId, snapshot.id, commitShas],
    )
    await client.query(
      `INSERT INTO repository_manual_approval_events (approval_id, event_type, actor_nav_ident)
       VALUES ($1, 'created', $2)`,
      [approvalId, actor.navIdent],
    )
    return { approvalId, commitShas }
  })
}

export async function revokeRepositoryManualApproval(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  approvalId: number,
  reason: string,
): Promise<boolean> {
  requireValidIds(repositoryId, deliveryId, approvalId)
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

async function readFullApprovalSnapshots(client: PoolClient, repositoryId: number, deliveryId: number) {
  const { rows } = await client.query<Snapshot>(
    `SELECT * FROM repository_approval_snapshots
     WHERE repository_id = $1 AND delivery_id = $2 ORDER BY id`,
    [repositoryId, deliveryId],
  )
  return rows
}

async function readApprovalSnapshotMetadata(client: PoolClient, repositoryId: number, deliveryId: number) {
  const { rows } = await client.query<Pick<Snapshot, 'id' | 'base_sha' | 'head_sha'>>(
    `SELECT s.id, s.base_sha, s.head_sha FROM repository_approval_snapshots s
     WHERE s.repository_id = $1 AND s.delivery_id = $2
       AND EXISTS (SELECT 1 FROM repository_manual_approvals a WHERE a.snapshot_id = s.id)
     ORDER BY s.id`,
    [repositoryId, deliveryId],
  )
  return rows
}

async function readRepositoryManualApprovalHistory<T extends Pick<Snapshot, 'id' | 'base_sha' | 'head_sha'>>(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  requireAccess: (client: PoolClient, actor: UserIdentity, repositoryId: number) => Promise<void>,
  readSnapshots: (client: PoolClient, repositoryId: number, deliveryId: number) => Promise<T[]>,
  transactionClient?: PoolClient,
) {
  requireValidIds(repositoryId, deliveryId)
  const read = async (client: PoolClient) => {
    await requireAccess(client, actor, repositoryId)
    const { rows } = await client.query<{
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
      `SELECT a.id, a.snapshot_id, a.reviewer_nav_ident, a.registered_by_nav_ident, a.reviewed_at, a.registered_at,
              a.review_documentation,
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
    const snapshots = await readSnapshots(client, repositoryId, deliveryId)
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
  }
  if (transactionClient) return read(transactionClient)
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    return read(client)
  })
}

export async function getRepositoryManualApprovalHistory(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  client?: PoolClient,
) {
  return readRepositoryManualApprovalHistory(
    actor,
    repositoryId,
    deliveryId,
    requireApprovalAccess,
    readFullApprovalSnapshots,
    client,
  )
}

export async function getRepositoryManualApprovalHistoryForAdmin(
  actor: UserIdentity,
  repositoryId: number,
  deliveryId: number,
  client?: PoolClient,
) {
  return readRepositoryManualApprovalHistory(
    actor,
    repositoryId,
    deliveryId,
    async (transaction, user, id) => {
      if (!(await canAccessRepositoryAdminWithClient(user, id, transaction))) {
        throw new RepositoryApprovalError('forbidden', 'Repository admin access required')
      }
    },
    readFullApprovalSnapshots,
    client,
  )
}

export async function getRepositoryApprovalPage(actor: UserIdentity, repositoryId: number, deliveryId: number) {
  requireValidIds(repositoryId, deliveryId)
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await requireApprovalAccess(client, actor, repositoryId)
    const { rows } = await client.query<{
      id: number
      base_sha: string
      head_sha: string
      first_deployed_at: Date | null
    }>(
      `SELECT c.id, c.base_sha, c.head_sha, min(d.created_at) AS first_deployed_at
       FROM repository_code_deliveries c
       LEFT JOIN deployments d ON d.repository_code_delivery_id = c.id AND d.repository_id = c.repository_id
       WHERE c.repository_id = $1 AND c.id = $2 GROUP BY c.id`,
      [repositoryId, deliveryId],
    )
    if (!rows[0]) throw new RepositoryApprovalError('not_found', 'Code delivery not found')
    const history = await readRepositoryManualApprovalHistory(
      actor,
      repositoryId,
      deliveryId,
      async () => {},
      readApprovalSnapshotMetadata,
      client,
    )
    const review =
      rows[0].base_sha.toLowerCase() === rows[0].head_sha.toLowerCase()
        ? null
        : await getRepositoryApprovalPreview(
            actor,
            repositoryId,
            deliveryId,
            client,
            new Set(
              history.commits
                .filter((commit) => commit.status === 'eligible')
                .map((commit) => commit.sha.toLowerCase()),
            ),
          )
    return {
      delivery: rows[0],
      review,
      manualApprovalHistory: presentRepositoryApprovalHistory(history),
    }
  })
}

export async function getRepositoryApprovalDeliveries(actor: UserIdentity, repositoryId: number, page: number) {
  requireValidIds(repositoryId, page)
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await requireApprovalAccess(client, actor, repositoryId)
    const { rows } = await client.query<{ id: number; baseSha: string; headSha: string; firstDeployedAt: Date | null }>(
      `SELECT c.id, c.base_sha AS "baseSha", c.head_sha AS "headSha", min(d.created_at) AS "firstDeployedAt"
       FROM repository_code_deliveries c
       LEFT JOIN deployments d ON d.repository_code_delivery_id = c.id AND d.repository_id = c.repository_id
       WHERE c.repository_id = $1 GROUP BY c.id ORDER BY c.id DESC LIMIT 51 OFFSET $2`,
      [repositoryId, (page - 1) * 50],
    )
    return { deliveries: rows.slice(0, 50), hasNextPage: rows.length > 50, page }
  })
}
