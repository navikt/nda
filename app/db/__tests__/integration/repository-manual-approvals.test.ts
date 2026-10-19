import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { UserIdentity } from '~/lib/auth.server'
import { assessRepositoryDeliveryApproval } from '~/lib/repository-code-delivery/approval-assessment'
import { createRepositoryCodeDelivery } from '../../repository-code-deliveries.server'
import {
  createRepositoryApprovalSnapshot,
  getRepositoryManualApprovalHistory,
  RepositoryApprovalError,
  registerRepositoryManualApproval,
  revokeRepositoryManualApproval,
} from '../../repository-manual-approvals.server'
import { seedRepository, truncateAllTables } from './helpers'

let pool: Pool
let repositoryId: number
let deliveryId: number
const baseSha = 'a'.repeat(40)
const firstSha = 'b'.repeat(40)
const headSha = 'c'.repeat(40)
const reviewedAt = new Date('2026-10-18T12:00:00Z')
const actor: UserIdentity = {
  navIdent: 'Z990003',
  role: 'admin',
  isActualAdmin: true,
  adminSuppressed: false,
  entraGroups: [],
}

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateAllTables(pool)
  repositoryId = await seedRepository(pool, {
    githubRepoId: '12345',
    githubOwner: 'navikt',
    githubRepoName: 'glad-fjord',
    defaultBranch: 'main',
  })
  deliveryId = (await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })).id
  await pool.query(
    `INSERT INTO users (nav_ident, display_name) VALUES
     ('Z990001', 'Glad Fjord'), ('Z990002', 'Rask Elv'), ('Z990003', 'Stille Skog');
     INSERT INTO user_github_accounts (github_username, nav_ident) VALUES
     ('glad-fjord', 'Z990001'), ('rask-elv', 'Z990002')`,
  )
  await pool.query(
    `INSERT INTO github_compare_raw_snapshots
       (github_repo_id, owner, repo, base_sha, head_sha, api_version, data)
     VALUES ('12345', 'navikt', 'glad-fjord', $1, $2, '2022-11-28', $3::jsonb)`,
    [
      baseSha,
      headSha,
      JSON.stringify({
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        commits: [
          { sha: firstSha, author: { login: 'glad-fjord' } },
          { sha: headSha, author: { login: 'rask-elv' } },
        ].map((commit) => ({
          ...commit,
          parents: [{ sha: baseSha }],
          commit: {
            message: 'Add feature',
            author: { name: 'Glad Fjord', date: '2026-10-17T10:00:00Z' },
            committer: { date: '2026-10-17T10:00:00Z' },
          },
        })),
      }),
    ],
  )
  await pool.query(
    `INSERT INTO github_commit_associated_prs_raw_snapshots
       (github_repo_id, owner, repo, sha, api_version, data, pagination_complete)
     SELECT '12345', 'navikt', 'glad-fjord', unnest($1::text[]), '2022-11-28', '[]'::jsonb, true`,
    [[firstSha, headSha]],
  )
})

async function approve(commitShas = [firstSha, headSha], reviewer = actor) {
  const snapshot = await createRepositoryApprovalSnapshot(reviewer, repositoryId, deliveryId)
  const id = await registerRepositoryManualApproval(reviewer, repositoryId, deliveryId, {
    snapshotId: snapshot.id,
    commitShas,
    reviewedAt,
  })
  return { id, snapshot }
}

async function history() {
  return getRepositoryManualApprovalHistory(actor, repositoryId, deliveryId)
}

describe('repository manual approval storage', () => {
  it('stores a hash reproducible from JSONB evidence regardless of object key order', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    const { snapshots } = await history()
    const serialized = JSON.stringify(snapshots[0].evidence, (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
          )
        : value,
    )
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(snapshot.evidence_hash)
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: snapshots[0].id,
        commitShas: [firstSha],
        reviewedAt,
      }),
    ).resolves.toBeTypeOf('number')
  })

  it('denies approval storage and revocation without current access', async () => {
    const { id, snapshot } = await approve()
    const unauthorized = { ...actor, role: 'user' as const, isActualAdmin: false, adminSuppressed: true }
    await expect(createRepositoryApprovalSnapshot(unauthorized, repositoryId, deliveryId)).rejects.toBeInstanceOf(
      RepositoryApprovalError,
    )
    await expect(
      registerRepositoryManualApproval(unauthorized, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      revokeRepositoryManualApproval(unauthorized, repositoryId, deliveryId, id, 'No access'),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('stores complete evidence, identities, separate review and registration times, and creation audit atomically', async () => {
    const { id, snapshot } = await approve()
    const result = await history()
    expect(result.snapshots).toEqual([snapshot])
    expect(result.snapshots[0].evidence.compare?.commits).toHaveLength(2)
    expect(result.commits).toHaveLength(2)
    expect(result.commits.every((commit) => commit.id === id && commit.status === 'eligible')).toBe(true)
    expect(result.commits[0]).toMatchObject({
      reviewer_nav_ident: actor.navIdent,
      registered_by_nav_ident: actor.navIdent,
      reviewed_at: reviewedAt,
      author_nav_ident: 'Z990001',
    })
    expect(result.commits[0].registered_at.getTime()).toBeGreaterThan(reviewedAt.getTime())
    expect(result.events).toMatchObject([{ approval_id: id, event_type: 'created', actor_nav_ident: actor.navIdent }])
  })

  it('combines approvals by authors for each other’s commits', async () => {
    await approve([headSha], { ...actor, navIdent: 'Z990001' })
    await approve([firstSha], { ...actor, navIdent: 'Z990002' })
    const { commits } = await history()
    const result = assessRepositoryDeliveryApproval({
      baseSha,
      headSha,
      totalCommits: 2,
      commitHistoryComplete: true,
      commits: [
        { sha: firstSha, authorIdentityKey: 'Z990001', prCoverage: 'not_approved' },
        { sha: headSha, authorIdentityKey: 'Z990002', prCoverage: 'not_approved' },
      ],
      approvals: commits
        .filter((commit) => commit.status === 'eligible')
        .map((commit) => ({
          approverIdentityKey: commit.reviewer_nav_ident,
          commitShas: [commit.sha],
        })),
    })
    expect(result.status).toBe('approved')
  })

  it('rejects self-approval without storing a partial result or audit event', async () => {
    const reviewer = { ...actor, navIdent: 'Z990001' }
    const snapshot = await createRepositoryApprovalSnapshot(reviewer, repositoryId, deliveryId)
    await expect(
      registerRepositoryManualApproval(reviewer, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [headSha, firstSha],
        reviewedAt,
      }),
    ).rejects.toMatchObject({ code: 'invalid_approval' })
    expect((await history()).commits).toEqual([])
    expect((await history()).events).toEqual([])
  })

  it.each(['missing', 'account_deleted', 'user_deleted'])('rejects an unresolved author: %s', async (state) => {
    if (state === 'missing') await pool.query(`DELETE FROM user_github_accounts WHERE github_username = 'glad-fjord'`)
    if (state === 'account_deleted')
      await pool.query(`UPDATE user_github_accounts SET deleted_at = NOW() WHERE github_username = 'glad-fjord'`)
    if (state === 'user_deleted') await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990001'`)
    await expect(approve([firstSha])).rejects.toMatchObject({ code: 'stale_ground' })
    expect((await history()).commits).toEqual([])
  })

  it('rejects a mapping changed after the snapshot was shown', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'glad-fjord'`)
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt,
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
  })

  it('rejects changed GitHub evidence without silently replacing the snapshot', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    await pool.query(
      `UPDATE github_compare_raw_snapshots SET data = jsonb_set(data, '{commits,0,commit,message}', '"Changed message"')`,
    )
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt,
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
  })

  it.each(['mapping', 'account', 'user'])('never reactivates old coverage after %s restoration', async (kind) => {
    await approve()
    if (kind === 'mapping') {
      await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'glad-fjord'`)
      await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990001' WHERE github_username = 'glad-fjord'`)
    } else if (kind === 'account') {
      await pool.query(`UPDATE user_github_accounts SET deleted_at = NOW() WHERE github_username = 'glad-fjord'`)
      await pool.query(`UPDATE user_github_accounts SET deleted_at = NULL WHERE github_username = 'glad-fjord'`)
    } else {
      await pool.query(`UPDATE users SET deleted_at = NOW() WHERE nav_ident = 'Z990001'`)
      await pool.query(`UPDATE users SET deleted_at = NULL WHERE nav_ident = 'Z990001'`)
    }
    const result = await history()
    expect(result.commits).toMatchObject([
      { sha: firstSha, author_nav_ident: 'Z990001', status: 'identity_or_interval_changed' },
      { sha: headSha, status: 'eligible' },
    ])
    expect(result.events).toHaveLength(1)
    expect(result.snapshots).toHaveLength(1)
    await approve([firstSha])
    expect((await history()).commits.filter((commit) => commit.status === 'eligible')).toHaveLength(2)
  })

  it('does not invalidate coverage when only profile data or the reviewer GitHub account changes', async () => {
    await approve()
    await pool.query(`UPDATE users SET display_name = 'Stille Fjord', updated_at = NOW()`)
    await pool.query(`INSERT INTO user_github_accounts (github_username, nav_ident) VALUES ('stille-skog', 'Z990003')`)
    await pool.query(`UPDATE user_github_accounts SET deleted_at = NOW() WHERE github_username = 'stille-skog'`)
    expect((await history()).commits.every((commit) => commit.status === 'eligible')).toBe(true)
  })

  it('appends a reasoned revocation while retaining the original, and reports repeat calls as no-ops', async () => {
    const { id, snapshot } = await approve()
    expect(await revokeRepositoryManualApproval(actor, repositoryId, deliveryId, id, 'Incorrect review')).toBe(true)
    expect(await revokeRepositoryManualApproval(actor, repositoryId, deliveryId, id, 'Repeated')).toBe(false)
    const result = await history()
    expect(result.snapshots).toEqual([snapshot])
    expect(result.commits.every((commit) => commit.status === 'revoked')).toBe(true)
    expect(result.events).toMatchObject([
      { event_type: 'created' },
      { event_type: 'revoked', reason: 'Incorrect review', actor_nav_ident: actor.navIdent },
    ])
  })

  it('scopes snapshot registration and revocation to both repository and delivery', async () => {
    const { id, snapshot } = await approve()
    const other = await seedRepository(pool, {
      githubRepoId: '54321',
      githubOwner: 'navikt',
      githubRepoName: 'rask-elv',
    })
    await expect(
      registerRepositoryManualApproval(actor, other, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(revokeRepositoryManualApproval(actor, other, deliveryId, id, 'Wrong scope')).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      revokeRepositoryManualApproval(actor, repositoryId, deliveryId + 1, id, 'Wrong scope'),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects incomplete history and unknown PR associations', async () => {
    await pool.query(`UPDATE github_compare_raw_snapshots SET data = jsonb_set(data, '{total_commits}', '3')`)
    await expect(createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)).rejects.toMatchObject({
      code: 'incomplete_evidence',
    })
    await pool.query(`UPDATE github_compare_raw_snapshots SET data = jsonb_set(data, '{total_commits}', '2')`)
    await pool.query(`UPDATE github_commit_associated_prs_raw_snapshots SET pagination_complete = false`)
    await expect(approve()).rejects.toMatchObject({ code: 'incomplete_evidence' })
  })

  it.each([
    { commitShas: [] },
    { commitShas: [baseSha] },
    { commitShas: [firstSha, firstSha] },
    { commitShas: ['not-a-sha'] },
  ])('rejects invalid commit selections: $commitShas', async ({ commitShas }) => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas,
        reviewedAt,
      }),
    ).rejects.toMatchObject({ code: 'invalid_approval' })
  })

  it('rejects future review time and empty revocation reasons', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toMatchObject({ code: 'invalid_approval' })
    const { id } = await approve()
    await expect(revokeRepositoryManualApproval(actor, repositoryId, deliveryId, id, ' ')).rejects.toMatchObject({
      code: 'invalid_approval',
    })
  })

  it('prevents updates and deletes of stored approval history', async () => {
    await approve()
    for (const table of [
      'repository_approval_snapshots',
      'repository_approval_snapshot_commits',
      'repository_manual_approvals',
      'repository_manual_approval_commits',
      'repository_manual_approval_events',
    ]) {
      await expect(pool.query(`DELETE FROM ${table}`)).rejects.toThrow('Repository approval history is immutable')
    }
    await expect(pool.query(`UPDATE repository_manual_approvals SET reviewer_nav_ident = 'Z990002'`)).rejects.toThrow(
      'Repository approval history is immutable',
    )
  })

  it.each(['mapping', 'user_and_account'] as const)(
    'rejects concurrent %s updates without stale approval or deadlock',
    async (kind) => {
      const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        if (kind === 'mapping') {
          await client.query(
            `UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'glad-fjord'`,
          )
        } else {
          await client.query(`UPDATE users SET display_name = 'Rask Fjord' WHERE nav_ident = 'Z990001'`)
        }
        const registration = registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
          snapshotId: snapshot.id,
          commitShas: [firstSha],
          reviewedAt,
        })
        const assertion = expect(registration).rejects.toMatchObject({ code: 'stale_ground' })
        const deadline = Date.now() + 5000
        let blocked = false
        while (Date.now() < deadline) {
          const { rows } = await pool.query<{ blocked: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND query LIKE $1) AS blocked`,
            [kind === 'mapping' ? '%FOR SHARE OF uga%' : '%FOR SHARE OF u%'],
          )
          if (rows[0].blocked) {
            blocked = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        if (kind === 'user_and_account') {
          await client.query(`SET LOCAL lock_timeout = '2s'`)
          await client.query(`UPDATE user_github_accounts SET updated_at = NOW() WHERE github_username = 'glad-fjord'`)
        }
        await client.query('COMMIT')
        await assertion
        expect(blocked).toBe(true)
        expect((await history()).commits).toEqual([])
      } finally {
        try {
          await client.query('ROLLBACK')
        } finally {
          client.release()
        }
      }
    },
  )
})
