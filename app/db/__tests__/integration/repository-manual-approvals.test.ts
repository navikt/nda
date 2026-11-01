import { createHash } from 'node:crypto'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assignTeamRole } from '~/db/role-assignments.server'
import type { UserIdentity } from '~/lib/auth.server'
import { assessRepositoryDeliveryApproval } from '~/lib/repository-code-delivery/approval-assessment'
import { action as revocationAction } from '~/routes/repository.$owner.$repo.admin.code-deliveries.$deliveryId.actions.server'
import { action as approvalAction } from '~/routes/repository.$owner.$repo.approvals.$deliveryId.actions.server'
import { createRepositoryCodeDelivery } from '../../repository-code-deliveries.server'
import { getRepositoryCodeDeliveryFollowUp } from '../../repository-code-delivery-follow-up.server'
import { getRepositoryCodeDeliveryEvidence } from '../../repository-code-delivery-overview.server'
import {
  approveRepositoryDelivery,
  createRepositoryApprovalReview,
  createRepositoryApprovalSnapshot,
  getRepositoryApprovalDeliveries,
  getRepositoryApprovalPage,
  getRepositoryManualApprovalHistory,
  getRepositoryManualApprovalHistoryForAdmin,
  RepositoryApprovalError,
  registerRepositoryManualApproval,
  revokeRepositoryManualApproval,
} from '../../repository-manual-approvals.server'
import { getGithubUserLookups } from '../../user-github-lookups.server'
import {
  seedApp,
  seedApplicationRepository,
  seedDeployment,
  seedDevTeam,
  seedRepository,
  seedSection,
  truncateAllTables,
} from './helpers'

let pool: Pool
const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }))
vi.mock('~/lib/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/auth.server')>()),
  requireUser,
}))
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
  requireUser.mockResolvedValue(actor)
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
    reviewDocumentation: 'Gjennomgått kodeendringene og relevante tester.',
  })
  return { id, snapshot }
}

async function history() {
  return getRepositoryManualApprovalHistory(actor, repositoryId, deliveryId)
}

function actionArgs(fields: Record<string, string | string[]>) {
  const body = new FormData()
  for (const [key, values] of Object.entries(fields)) {
    for (const value of Array.isArray(values) ? values : [values]) body.append(key, value)
  }
  return {
    params: { owner: 'navikt', repo: 'glad-fjord', deliveryId: String(deliveryId) },
    request: new Request(
      `http://localhost/repository/navikt/glad-fjord/approvals/${deliveryId}?repositoryId=${repositoryId}`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body,
      },
    ),
  } as never
}

describe('repository manual approval storage', () => {
  it('filters follow-up using current eligible approvals and excludes revoked and changed identities', async () => {
    const readFollowUp = async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return await getRepositoryCodeDeliveryFollowUp(repositoryId, { page: 1, pageSize: 20, status: 'all' }, client)
      } finally {
        try {
          await client.query('ROLLBACK')
        } finally {
          client.release()
        }
      }
    }
    expect((await readFollowUp()).deliveries[0].followUp).toMatchObject({ status: 'not_approved', needsApproval: 2 })
    const approval = await approve()
    expect((await readFollowUp()).deliveries[0].followUp).toMatchObject({
      status: 'approved',
      covered: 2,
      needsApproval: 0,
    })
    await revokeRepositoryManualApproval(actor, repositoryId, deliveryId, approval.id, 'Feil grunnlag')
    expect((await readFollowUp()).deliveries[0].followUp).toMatchObject({ status: 'not_approved', needsApproval: 2 })
    await approve()
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'glad-fjord'`)
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990001' WHERE github_username = 'glad-fjord'`)
    expect((await readFollowUp()).deliveries[0].followUp).toMatchObject({
      status: 'not_approved',
      covered: 1,
      needsApproval: 1,
    })
  })

  it('does not retain the unused documentation URL column', async () => {
    const { rows } = await pool.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'repository_manual_approvals'
           AND column_name = 'documentation_url'
       ) AS present`,
    )
    expect(rows[0].present).toBe(false)
  })

  it('previews without storing and atomically approves only commits missing PR coverage', async () => {
    expect((await getRepositoryApprovalPage(actor, repositoryId, deliveryId)).manualApprovalHistory).toEqual([])
    expect((await history()).snapshots).toEqual([])
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    expect(preview.review?.commits.map((commit) => commit.sha)).toEqual([firstSha, headSha])
    expect((await history()).commits).toEqual([])
    expect((await history()).snapshots).toEqual([])
    const fields = { intent: 'approve-repository', previewToken: preview.review?.previewToken ?? '', note: 'Godkjent.' }
    expect(await approvalAction(actionArgs(fields))).toMatchObject({ registered: true })
    const stored = await history()
    expect(stored.commits).toMatchObject([
      {
        sha: firstSha,
        reviewer_nav_ident: actor.navIdent,
        registered_by_nav_ident: actor.navIdent,
        review_documentation: fields.note,
      },
      { sha: headSha, reviewer_nav_ident: actor.navIdent },
    ])
    expect(stored.commits).toHaveLength(2)
    expect(stored.snapshots).toHaveLength(1)
    const revoke = { intent: 'revoke-approval', approvalId: String(stored.commits[0].id), reason: 'Feil grunnlag.' }
    expect(await revocationAction(actionArgs({ ...revoke, reason: '' }))).toHaveProperty('error')
    expect(await revocationAction(actionArgs(revoke))).toHaveProperty('success')
    expect(await revocationAction(actionArgs(revoke))).toHaveProperty('error')
    expect((await history()).events.map((event) => event.event_type)).toEqual(['created', 'revoked'])
  })

  it('rejects a changed author mapping without storing a snapshot or approval', async () => {
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    const fields = { intent: 'approve-repository', previewToken: preview.review?.previewToken ?? '', note: '' }
    expect(await approvalAction(actionArgs({ ...fields, previewToken: 'f'.repeat(64) }))).toHaveProperty('error')
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'glad-fjord'`)
    expect(await approvalAction(actionArgs(fields))).toMatchObject({ stale: true, error: expect.any(String) })
    const stored = await history()
    expect(stored.snapshots).toEqual([])
    expect(stored.commits).toEqual([])
    expect(stored.events).toEqual([])
  })

  it('invalidates a preview when another approval changes the eligible commit set', async () => {
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    await approve([firstSha])
    await expect(
      approveRepositoryDelivery(actor, repositoryId, deliveryId, {
        previewToken: preview.review?.previewToken ?? '',
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
    expect((await history()).commits).toHaveLength(1)
  })

  it('rejects a preview token issued to another reviewer', async () => {
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    await expect(
      approveRepositoryDelivery({ ...actor, navIdent: 'Z990004' }, repositoryId, deliveryId, {
        previewToken: preview.review?.previewToken ?? '',
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
    expect((await history()).commits).toEqual([])
  })

  it('does not treat historical approval as coverage after the current commit author changes', async () => {
    await approve([firstSha])
    await pool.query(
      `UPDATE github_compare_raw_snapshots
       SET data = jsonb_set(data, '{commits,0,author,login}', '"rask-elv"')`,
    )
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    expect(preview.review?.commits[0]).toMatchObject({
      authorLogin: 'rask-elv',
      authorNavIdent: 'Z990002',
      unavailableReason: null,
    })
    expect(preview.manualApprovalHistory[0].commits[0]).toMatchObject({
      sha: firstSha,
      status: 'identity_or_interval_changed',
    })
  })

  it('retains approval history when current delivery evidence is incomplete', async () => {
    await approve([firstSha])
    await pool.query('DELETE FROM github_compare_raw_snapshots')
    const page = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    expect(page.review).toBeNull()
    expect(page.manualApprovalHistory).toMatchObject([{ commits: [{ sha: firstSha, status: 'eligible' }] }])
  })

  it('serializes concurrent approvals so only one registration succeeds', async () => {
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    const fields = {
      intent: 'approve-repository',
      previewToken: preview.review?.previewToken ?? '',
      note: '',
    }
    const results = await Promise.all([approvalAction(actionArgs(fields)), approvalAction(actionArgs(fields))])
    expect(results.filter((result) => 'registered' in result && result.registered)).toHaveLength(1)
    expect(results.filter((result) => 'stale' in result && result.stale)).toHaveLength(1)
    expect((await history()).commits).toHaveLength(2)
  })

  it('approves a commit missing PR review but never a commit already covered by PR review', async () => {
    await pool.query(
      `UPDATE github_commit_associated_prs_raw_snapshots
       SET data = '[{"number":42,"base":{"ref":"main"}}]'::jsonb WHERE sha = $1`,
      [firstSha],
    )
    await pool.query(
      `INSERT INTO github_pr_raw_snapshots (github_repo_id, owner, repo, pr_number, data_type, api_version, data)
       VALUES ('12345', 'navikt', 'glad-fjord', 42, 'pr', '2022-11-28', $1::jsonb),
              ('12345', 'navikt', 'glad-fjord', 42, 'reviews', '2022-11-28', $2::jsonb),
              ('12345', 'navikt', 'glad-fjord', 42, 'commits', '2022-11-28', $3::jsonb)`,
      [
        JSON.stringify({
          number: 42,
          base: { ref: 'main' },
          head: { sha: firstSha },
          commits: 1,
          user: { login: 'glad-fjord' },
          merged_by: { login: 'rask-elv' },
          merge_commit_sha: null,
        }),
        JSON.stringify([
          {
            id: 1,
            user: { login: 'rask-elv' },
            state: 'APPROVED',
            submitted_at: '2026-10-17T11:00:00Z',
            commit_id: firstSha,
          },
        ]),
        JSON.stringify([
          {
            sha: firstSha,
            parents: [{ sha: baseSha }],
            author: { login: 'glad-fjord' },
            commit: {
              message: 'Add feature',
              author: { date: '2026-10-17T09:00:00Z' },
              committer: { date: '2026-10-17T10:00:00Z' },
            },
          },
        ]),
      ],
    )
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    expect(preview.review?.commits[0]).toMatchObject({
      prStatus: 'covered',
      unavailableReason: 'Denne committen er allerede dekket av PR-review.',
    })
    expect(preview.review?.commits[1]).toMatchObject({ prStatus: 'not_covered', unavailableReason: null })
    expect(
      await approvalAction(
        actionArgs({ intent: 'approve-repository', previewToken: preview.review?.previewToken ?? '', note: '' }),
      ),
    ).toMatchObject({ registered: true })
    expect((await history()).commits.map((commit) => commit.sha)).toEqual([headSha])
  })

  it('does not allow approval when PR coverage is unknown', async () => {
    await pool.query('DELETE FROM github_commit_associated_prs_raw_snapshots')
    const preview = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
    expect(preview.review?.commits.every((commit) => commit.prStatus === 'unknown')).toBe(true)
    expect(
      await approvalAction(
        actionArgs({ intent: 'approve-repository', previewToken: preview.review?.previewToken ?? '', note: '' }),
      ),
    ).toMatchObject({ error: expect.stringContaining('Ukjent PR-grunnlag') })
    expect((await history()).snapshots).toEqual([])
    expect((await history()).commits).toEqual([])
  })

  it('presents the frozen PR input and rejects a changed review without refreshing it', async () => {
    await pool.query(
      `UPDATE github_commit_associated_prs_raw_snapshots SET data = '[{"number":42,"base":{"ref":"main"}}]'::jsonb WHERE sha = $1`,
      [firstSha],
    )
    await pool.query(
      `INSERT INTO github_pr_raw_snapshots (github_repo_id, owner, repo, pr_number, data_type, api_version, data)
       VALUES ('12345', 'navikt', 'glad-fjord', 42, 'pr', '2022-11-28', $1::jsonb),
              ('12345', 'navikt', 'glad-fjord', 42, 'reviews', '2022-11-28', $2::jsonb),
              ('12345', 'navikt', 'glad-fjord', 42, 'commits', '2022-11-28', $3::jsonb)`,
      [
        JSON.stringify({
          number: 42,
          base: { ref: 'main' },
          head: { sha: firstSha },
          commits: 1,
          user: { login: 'glad-fjord' },
          merged_by: { login: 'rask-elv' },
          merge_commit_sha: null,
        }),
        JSON.stringify([
          {
            id: 1,
            user: { login: 'rask-elv' },
            state: 'APPROVED',
            submitted_at: '2026-10-17T11:00:00Z',
            commit_id: firstSha,
          },
        ]),
        JSON.stringify([
          {
            sha: firstSha,
            parents: [{ sha: baseSha }],
            author: { login: 'glad-fjord' },
            commit: {
              message: 'Add feature',
              author: { date: '2026-10-17T09:00:00Z' },
              committer: { date: '2026-10-17T10:00:00Z' },
            },
          },
        ]),
      ],
    )
    const review = await createRepositoryApprovalReview(actor, repositoryId, deliveryId)
    expect(review.commits[0]).toMatchObject({
      prStatus: 'covered',
      associations: { complete: true, pullRequests: [{ number: 42, baseBranch: 'main' }] },
    })
    expect(review.pullRequests).toMatchObject([
      {
        number: 42,
        authorLogin: 'glad-fjord',
        mergedByLogin: 'rask-elv',
        commits: [{ sha: firstSha, authorLogin: 'glad-fjord' }],
        reviews: [{ username: 'rask-elv', state: 'APPROVED', commitSha: firstSha }],
      },
    ])
    await pool.query(
      `UPDATE github_pr_raw_snapshots SET data = jsonb_set(data, '{0,state}', '"CHANGES_REQUESTED"') WHERE data_type = 'reviews'`,
    )
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: review.snapshotId,
        commitShas: [firstSha],
        reviewedAt,
        reviewDocumentation: 'Gjennomgått kode.',
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
    expect(review.pullRequests[0].reviews[0].state).toBe('APPROVED')
  })

  it('presents the immutable snapshot before any approval and excludes internal evidence and identity versions', async () => {
    const review = await createRepositoryApprovalReview({ ...actor, navIdent: 'Z990001' }, repositoryId, deliveryId)
    expect(review).toMatchObject({
      baseSha,
      headSha,
      reviewer: 'Z990001',
      defaultBranch: 'main',
      commits: [
        {
          sha: firstSha,
          authorNavIdent: 'Z990001',
          unavailableReason: 'Du kan ikke godkjenne dine egne commits.',
          committerDate: '2026-10-17T10:00:00Z',
        },
        { sha: headSha, authorNavIdent: 'Z990002', unavailableReason: null },
      ],
    })
    expect(JSON.stringify(review)).not.toMatch(/evidence_hash|identity_version|evidenceHash|identityVersion/)
    expect((await history()).commits).toEqual([])
    expect((await history()).snapshots).toHaveLength(1)
    await pool.query(
      `UPDATE github_compare_raw_snapshots SET data = jsonb_set(data, '{commits,0,commit,message}', '"Changed"')`,
    )
    expect(review.commits[0].message).toBe('Add feature')
  })

  it('lets a member without repository admin rights reach the scoped flow but not revoke', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'glad-fjord', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'glad-fjord',
      githubRepoId: '12345',
    })
    const sectionId = await seedSection(pool, 'fjord')
    const teamId = await seedDevTeam(pool, 'team-fjord', 'Glad Fjord', sectionId)
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])
    await assignTeamRole('Z990003', teamId, 'utvikler', 'Z990001')
    const reviewer = { ...actor, role: 'user' as const, isActualAdmin: false, adminSuppressed: true }
    expect(await getRepositoryApprovalDeliveries(reviewer, repositoryId, 1)).toMatchObject({
      deliveries: [{ id: deliveryId }],
      hasNextPage: false,
    })
    const before = await getRepositoryApprovalPage(reviewer, repositoryId, deliveryId)
    expect(before.manualApprovalHistory).toEqual([])
    expect(await history()).toMatchObject({ snapshots: [] })
    const { id } = await approve([firstSha], reviewer)
    const page = await getRepositoryApprovalPage(reviewer, repositoryId, deliveryId)
    expect(page.manualApprovalHistory).toMatchObject([
      { id, reviewDocumentation: 'Gjennomgått kodeendringene og relevante tester.' },
    ])
    expect(page).not.toHaveProperty('affectedApps')
    expect(page).not.toHaveProperty('snapshots')
    await expect(getRepositoryManualApprovalHistoryForAdmin(reviewer, repositoryId, deliveryId)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(revokeRepositoryManualApproval(reviewer, repositoryId, deliveryId, id, 'Feil')).rejects.toMatchObject({
      code: 'forbidden',
    })
    await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [appId])
    await expect(getRepositoryApprovalPage(reviewer, repositoryId, deliveryId)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it.each([{ reviewDocumentation: '' }, { reviewDocumentation: '   ' }])(
    'requires review documentation: %j',
    async (documentation) => {
      const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
      await expect(
        registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
          snapshotId: snapshot.id,
          commitShas: [firstSha],
          reviewedAt,
          ...documentation,
        }),
      ).rejects.toMatchObject({ code: 'invalid_approval' })
      expect((await history()).commits).toEqual([])
    },
  )

  it('checks the latest selected timestamp, not an unselected commit, and permits equality', async () => {
    await pool.query(
      `UPDATE github_compare_raw_snapshots SET data = jsonb_set(data, '{commits,1,commit,committer,date}', '"2026-10-18T13:00:00Z"')`,
    )
    const review = await createRepositoryApprovalReview(actor, repositoryId, deliveryId)
    const input = {
      snapshotId: review.snapshotId,
      commitShas: [firstSha, headSha],
      reviewedAt,
      reviewDocumentation: 'Gjennomgått kode.',
    }
    await expect(registerRepositoryManualApproval(actor, repositoryId, deliveryId, input)).rejects.toMatchObject({
      code: 'invalid_approval',
    })
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        ...input,
        commitShas: [firstSha],
        reviewedAt: new Date('2026-10-17T10:00:00Z'),
      }),
    ).resolves.toBeTypeOf('number')
    expect((await history()).commits.map((commit) => commit.sha)).toEqual([firstSha])
  })

  it.each([null, '', 'invalid', '2026-02-30T12:00:00Z'])(
    'fails closed for missing or invalid committer-time %j without author-time fallback',
    async (time) => {
      await pool.query(
        `UPDATE github_compare_raw_snapshots SET data = jsonb_set(data, '{commits,0,commit,committer,date}', $1::jsonb)`,
        [JSON.stringify(time)],
      )
      const review = await createRepositoryApprovalReview(actor, repositoryId, deliveryId)
      expect(review.commits[0].unavailableReason).toContain('committer-tid mangler eller er ugyldig')
      await expect(
        registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
          snapshotId: review.snapshotId,
          commitShas: [firstSha],
          reviewedAt,
          reviewDocumentation: 'Gjennomgått kode.',
        }),
      ).rejects.toMatchObject({ code: 'incomplete_evidence' })
      await expect(
        registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
          snapshotId: review.snapshotId,
          commitShas: [headSha],
          reviewedAt,
          reviewDocumentation: 'Gjennomgått kode.',
        }),
      ).resolves.toBeTypeOf('number')
    },
  )

  it('rejects a mapping change even for an unselected commit in the displayed ground', async () => {
    const review = await createRepositoryApprovalReview(actor, repositoryId, deliveryId)
    await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990001' WHERE github_username = 'rask-elv'`)
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: review.snapshotId,
        commitShas: [firstSha],
        reviewedAt,
        reviewDocumentation: 'Gjennomgått kode.',
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
    expect((await history()).snapshots).toHaveLength(1)
    expect((await history()).commits).toEqual([])
  })

  it('rejects a reviewer identity change after displaying the snapshot', async () => {
    const review = await createRepositoryApprovalReview(actor, repositoryId, deliveryId)
    await expect(
      registerRepositoryManualApproval({ ...actor, navIdent: 'Z990002' }, repositoryId, deliveryId, {
        snapshotId: review.snapshotId,
        commitShas: [firstSha],
        reviewedAt,
        reviewDocumentation: 'Gjennomgått kode.',
      }),
    ).rejects.toMatchObject({ code: 'stale_ground' })
    expect((await history()).commits).toEqual([])
  })

  it('rejects snapshots from another delivery and nonexistent snapshots', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    const other = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha: 'd'.repeat(40) })
    const input = {
      snapshotId: snapshot.id,
      commitShas: [firstSha],
      reviewedAt,
      reviewDocumentation: 'Gjennomgått kode.',
    }
    await expect(registerRepositoryManualApproval(actor, repositoryId, other.id, input)).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, { ...input, snapshotId: snapshot.id + 1 }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect((await history()).commits).toEqual([])
  })

  it.each([0, -1, NaN, Infinity, 1.5, 2_147_483_648])('rejects invalid numeric approval IDs %s', async (invalidId) => {
    await expect(createRepositoryApprovalSnapshot(actor, invalidId, deliveryId)).rejects.toMatchObject({
      code: 'invalid_approval',
    })
    await expect(createRepositoryApprovalSnapshot(actor, repositoryId, invalidId)).rejects.toMatchObject({
      code: 'invalid_approval',
    })
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: invalidId,
        commitShas: [firstSha],
        reviewedAt,
        reviewDocumentation: 'Gjennomgått kode.',
      }),
    ).rejects.toMatchObject({ code: 'invalid_approval' })
    await expect(
      revokeRepositoryManualApproval(actor, repositoryId, deliveryId, invalidId, 'Feil grunnlag'),
    ).rejects.toMatchObject({ code: 'invalid_approval' })
    expect((await history()).snapshots).toEqual([])
  })

  it.each(['canonical', 'delivery_only'] as const)(
    'allows review after deployment with %s identity without updating deployment assessment',
    async (identity) => {
      const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'glad-fjord', environment: 'prod-gcp' })
      const deployedAt = new Date('2026-10-17T12:00:00Z')
      const deploymentId = await seedDeployment(pool, {
        monitoredAppId: appId,
        teamSlug: 'team-fjord',
        environment: 'prod-gcp',
        commitSha: headSha,
        createdAt: deployedAt,
        fourEyesStatus: 'direct_push',
      })
      await pool.query('UPDATE deployments SET repository_id = $1, repository_code_delivery_id = $2 WHERE id = $3', [
        repositoryId,
        deliveryId,
        deploymentId,
      ])
      if (identity === 'delivery_only') {
        await pool.query(
          'INSERT INTO repository_code_delivery_deployment_repositories (deployment_id, repository_id) VALUES ($1, $2)',
          [deploymentId, repositoryId],
        )
        await pool.query('UPDATE deployments SET repository_id = NULL WHERE id = $1', [deploymentId])
      }
      const before = await pool.query('SELECT * FROM deployments WHERE id = $1', [deploymentId])
      const { id } = await approve([firstSha])
      const page = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
      expect(page.delivery.first_deployed_at).toEqual(deployedAt)
      expect((await getRepositoryApprovalDeliveries(actor, repositoryId, 1)).deliveries).toContainEqual(
        expect.objectContaining({ id: deliveryId, firstDeployedAt: deployedAt }),
      )
      expect(page.manualApprovalHistory).toMatchObject([{ id, reviewedAt }])
      expect((await pool.query('SELECT * FROM deployments WHERE id = $1', [deploymentId])).rows).toEqual(before.rows)
      expect((await pool.query('SELECT count(*)::int AS count FROM verification_runs')).rows[0].count).toBe(0)
    },
  )

  it('retains null documentation for legacy rows without inventing a review description', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO repository_manual_approvals (snapshot_id, reviewer_nav_ident, registered_by_nav_ident, reviewed_at) VALUES ($1, $2, $2, $3) RETURNING id`,
      [snapshot.id, actor.navIdent, reviewedAt],
    )
    await pool.query(
      'INSERT INTO repository_manual_approval_commits (approval_id, snapshot_id, sha) VALUES ($1, $2, $3)',
      [rows[0].id, snapshot.id, firstSha],
    )
    expect((await getRepositoryApprovalPage(actor, repositoryId, deliveryId)).manualApprovalHistory).toMatchObject([
      { reviewDocumentation: null },
    ])
  })

  it('allows historical repository admins to read full history without granting approval rights', async () => {
    const { id, snapshot } = await approve()
    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'glad-fjord', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'glad-fjord',
      githubRepoId: '12345',
      status: 'historical',
    })
    const sectionId = await seedSection(pool, 'fjord')
    const teamId = await seedDevTeam(pool, 'team-fjord', 'Glad Fjord', sectionId)
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])
    await assignTeamRole('Z990002', teamId, 'tech_lead', 'Z990003')
    const reviewer: UserIdentity = {
      ...actor,
      navIdent: 'Z990002',
      role: 'user',
      isActualAdmin: false,
      adminSuppressed: true,
    }
    const expected = await history()
    expect(await getRepositoryManualApprovalHistoryForAdmin(reviewer, repositoryId, deliveryId)).toEqual(expected)
    await expect(getRepositoryManualApprovalHistory(reviewer, repositoryId, deliveryId)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(createRepositoryApprovalSnapshot(reviewer, repositoryId, deliveryId)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      registerRepositoryManualApproval(reviewer, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt,
        reviewDocumentation: 'Gjennomgått endringene.',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(expected.commits.every((commit) => commit.id === id)).toBe(true)
    expect(
      await revokeRepositoryManualApproval(
        reviewer,
        repositoryId,
        deliveryId,
        id,
        'Feil grunnlag i historisk leveranse.',
      ),
    ).toBe(true)
    await expect(
      getRepositoryManualApprovalHistoryForAdmin({ ...reviewer, navIdent: 'Z990001' }, repositoryId, deliveryId),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('loads only snapshot metadata for approvals while preserving complete snapshot history', async () => {
    await createRepositoryApprovalReview(actor, repositoryId, deliveryId)
    const { id } = await approve()
    const query = vi.spyOn(Client.prototype, 'query')
    try {
      const page = await getRepositoryApprovalPage(actor, repositoryId, deliveryId)
      expect(page.manualApprovalHistory.map((approval) => approval.id)).toEqual([id])
      const snapshotReads = query.mock.calls
        .map(([sql]) => sql)
        .filter((sql): sql is string => typeof sql === 'string' && sql.includes('FROM repository_approval_snapshots'))
      expect(snapshotReads).toHaveLength(1)
      expect(snapshotReads[0]).toContain('SELECT s.id, s.base_sha, s.head_sha')
      expect(snapshotReads[0]).toContain('EXISTS')
      expect(snapshotReads[0]).not.toContain('evidence')
      expect(snapshotReads[0]).not.toContain('*')
    } finally {
      query.mockRestore()
    }
    const complete = await history()
    expect(complete.snapshots).toHaveLength(2)
    expect(complete.snapshots.every((snapshot) => snapshot.evidence.compare?.commits.length === 2)).toBe(true)
  })

  it('rejects starting a review for a history anchor without storing a snapshot', async () => {
    const anchor = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha: baseSha })
    await expect(createRepositoryApprovalReview(actor, repositoryId, anchor.id)).rejects.toMatchObject({
      code: 'incomplete_evidence',
    })
    expect((await getRepositoryManualApprovalHistory(actor, repositoryId, anchor.id)).snapshots).toEqual([])
  })

  it('reads evidence, author identities and revocations from the same read-only snapshot', async () => {
    const { id } = await approve()
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const before = await getRepositoryCodeDeliveryEvidence(repositoryId, deliveryId, 1, client)
      await revokeRepositoryManualApproval(actor, repositoryId, deliveryId, id, 'Changed ground')
      await pool.query(`UPDATE user_github_accounts SET nav_ident = 'Z990002' WHERE github_username = 'glad-fjord'`)
      await pool.query('DELETE FROM github_commit_associated_prs_raw_snapshots')
      const evidence = await getRepositoryCodeDeliveryEvidence(repositoryId, deliveryId, 1, client)
      const approvals = await getRepositoryManualApprovalHistory(actor, repositoryId, deliveryId, client)
      const identities = await getGithubUserLookups(['glad-fjord'], client)
      expect(evidence).toEqual(before)
      expect(approvals.commits.every((commit) => commit.status === 'eligible')).toBe(true)
      expect(approvals.events).toHaveLength(1)
      expect(identities.get('glad-fjord')?.active_nav_ident).toBe('Z990001')
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
    expect((await history()).commits.every((commit) => commit.status === 'revoked')).toBe(true)
    expect((await getGithubUserLookups(['glad-fjord'])).get('glad-fjord')?.active_nav_ident).toBe('Z990002')
    expect(
      (await getRepositoryCodeDeliveryEvidence(repositoryId, deliveryId))?.interval_assessment.summary.unknown,
    ).toBe(2)
  })

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
        reviewDocumentation: 'Gjennomgått endringene.',
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
        reviewDocumentation: 'Gjennomgått endringene.',
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
      review_documentation: 'Gjennomgått kodeendringene og relevante tester.',
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
        reviewDocumentation: 'Gjennomgått endringene.',
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
        reviewDocumentation: 'Gjennomgått endringene.',
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
        reviewDocumentation: 'Gjennomgått endringene.',
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
        reviewDocumentation: 'Gjennomgått endringene.',
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
        reviewDocumentation: 'Gjennomgått endringene.',
      }),
    ).rejects.toMatchObject({ code: commitShas.includes(baseSha) ? 'commit_outside_snapshot' : 'invalid_approval' })
  })

  it('rejects future review time and empty revocation reasons', async () => {
    const snapshot = await createRepositoryApprovalSnapshot(actor, repositoryId, deliveryId)
    await expect(
      registerRepositoryManualApproval(actor, repositoryId, deliveryId, {
        snapshotId: snapshot.id,
        commitShas: [firstSha],
        reviewedAt: new Date(Date.now() + 86_400_000),
        reviewDocumentation: 'Gjennomgått endringene.',
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
          reviewDocumentation: 'Gjennomgått endringene.',
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
