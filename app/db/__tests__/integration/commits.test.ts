import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})
afterEach(async () => {
  await truncateAllTables(pool)
})

describe('commits', () => {
  it('inserts a commit and retrieves it', async () => {
    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas)
       VALUES ('abc123', 'navikt', 'repo', 'alice', 'feat: thing', false, '["parent1"]')`,
    )

    const { rows } = await pool.query(
      "SELECT * FROM commits WHERE sha = 'abc123' AND repo_owner = 'navikt' AND repo_name = 'repo'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].author_username).toBe('alice')
    expect(rows[0].is_merge_commit).toBe(false)
  })

  it('upsert with ON CONFLICT updates fields using COALESCE', async () => {
    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas)
       VALUES ('sha1', 'navikt', 'repo', 'alice', 'initial', false, '[]')`,
    )

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas,
         pr_approved, pr_approval_reason, original_pr_number, updated_at)
       VALUES ('sha1', 'navikt', 'repo', 'alice', 'initial', false, '[]', true, 'review', 42, NOW())
       ON CONFLICT (repo_owner, repo_name, sha) DO UPDATE SET
         pr_approved = COALESCE(EXCLUDED.pr_approved, commits.pr_approved),
         pr_approval_reason = COALESCE(EXCLUDED.pr_approval_reason, commits.pr_approval_reason),
         original_pr_number = COALESCE(EXCLUDED.original_pr_number, commits.original_pr_number),
         updated_at = NOW()`,
    )

    const { rows } = await pool.query("SELECT * FROM commits WHERE sha = 'sha1' AND repo_owner = 'navikt'")
    expect(rows[0].pr_approved).toBe(true)
    expect(rows[0].pr_approval_reason).toBe('review')
    expect(rows[0].original_pr_number).toBe(42)
  })

  it('COALESCE preserves existing values when upserting with null', async () => {
    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas,
         pr_approved, pr_approval_reason)
       VALUES ('sha2', 'navikt', 'repo', 'bob', 'existing', false, '[]', true, 'review')`,
    )

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas, updated_at)
       VALUES ('sha2', 'navikt', 'repo', 'bob', 'existing', false, '[]', NOW())
       ON CONFLICT (repo_owner, repo_name, sha) DO UPDATE SET
         pr_approved = COALESCE(EXCLUDED.pr_approved, commits.pr_approved),
         pr_approval_reason = COALESCE(EXCLUDED.pr_approval_reason, commits.pr_approval_reason),
         updated_at = NOW()`,
    )

    const { rows } = await pool.query("SELECT * FROM commits WHERE sha = 'sha2'")
    expect(rows[0].pr_approved).toBe(true)
    expect(rows[0].pr_approval_reason).toBe('review')
  })

  it('enforces unique constraint on (repo_owner, repo_name, sha)', async () => {
    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, message, is_merge_commit, parent_shas)
       VALUES ('dup', 'navikt', 'repo', 'first', false, '[]')`,
    )
    await expect(
      pool.query(
        `INSERT INTO commits (sha, repo_owner, repo_name, message, is_merge_commit, parent_shas)
         VALUES ('dup', 'navikt', 'repo', 'second', false, '[]')`,
      ),
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('hasCommitsCached check works', async () => {
    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, message, is_merge_commit, parent_shas)
       VALUES ('cached1', 'navikt', 'repo', 'msg', false, '[]')`,
    )

    const { rows: found } = await pool.query(
      "SELECT 1 FROM commits WHERE repo_owner = 'navikt' AND repo_name = 'repo' AND sha = 'cached1' LIMIT 1",
    )
    expect(found).toHaveLength(1)

    const { rows: notFound } = await pool.query(
      "SELECT 1 FROM commits WHERE repo_owner = 'navikt' AND repo_name = 'repo' AND sha = 'nope' LIMIT 1",
    )
    expect(notFound).toHaveLength(0)
  })

  it('updateCommitPrVerification updates verification fields', async () => {
    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, message, is_merge_commit, parent_shas)
       VALUES ('verify1', 'navikt', 'repo', 'msg', false, '[]')`,
    )

    await pool.query(
      `UPDATE commits SET original_pr_number = $4, original_pr_title = $5, original_pr_url = $6,
         pr_approved = $7, pr_approval_reason = $8, updated_at = NOW()
       WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3`,
      ['navikt', 'repo', 'verify1', 99, 'Fix bug', 'https://github.com/navikt/repo/pull/99', true, 'review'],
    )

    const { rows } = await pool.query("SELECT * FROM commits WHERE sha = 'verify1'")
    expect(rows[0].original_pr_number).toBe(99)
    expect(rows[0].original_pr_title).toBe('Fix bug')
    expect(rows[0].pr_approved).toBe(true)
  })
})
