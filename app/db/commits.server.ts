import { pool } from './connection.server'

interface Commit {
  sha: string
  repo_owner: string
  repo_name: string
  author_username: string | null
  author_date: Date | null
  committer_date: Date | null
  message: string | null
  parent_shas: string[]
  original_pr_number: number | null
  original_pr_title: string | null
  original_pr_url: string | null
  pr_approved: boolean | null
  pr_approval_reason: string | null
  is_merge_commit: boolean
  html_url: string | null
  created_at: Date
  updated_at: Date
}

interface UpsertCommitParams {
  sha: string
  repoOwner: string
  repoName: string
  authorUsername?: string | null
  authorDate?: Date | null
  committerDate?: Date | null
  message?: string | null
  parentShas?: string[]
  originalPrNumber?: number | null
  originalPrTitle?: string | null
  originalPrUrl?: string | null
  prApproved?: boolean | null
  prApprovalReason?: string | null
  isMergeCommit?: boolean
  htmlUrl?: string | null
}

/**
 * Batch upsert multiple commits
 */
async function upsertCommits(commits: UpsertCommitParams[]): Promise<number> {
  if (commits.length === 0) return 0

  // Use a transaction for batch insert
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const commit of commits) {
      await client.query(
        `INSERT INTO commits (
          sha, repo_owner, repo_name, author_username, author_date, committer_date,
          message, parent_shas, original_pr_number, original_pr_title, original_pr_url,
          pr_approved, pr_approval_reason, is_merge_commit, html_url, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (repo_owner, repo_name, sha) DO UPDATE SET
          author_username = COALESCE(EXCLUDED.author_username, commits.author_username),
          author_date = COALESCE(EXCLUDED.author_date, commits.author_date),
          committer_date = COALESCE(EXCLUDED.committer_date, commits.committer_date),
          message = COALESCE(EXCLUDED.message, commits.message),
          parent_shas = COALESCE(EXCLUDED.parent_shas, commits.parent_shas),
          original_pr_number = COALESCE(EXCLUDED.original_pr_number, commits.original_pr_number),
          original_pr_title = COALESCE(EXCLUDED.original_pr_title, commits.original_pr_title),
          original_pr_url = COALESCE(EXCLUDED.original_pr_url, commits.original_pr_url),
          pr_approved = COALESCE(EXCLUDED.pr_approved, commits.pr_approved),
          pr_approval_reason = COALESCE(EXCLUDED.pr_approval_reason, commits.pr_approval_reason),
          is_merge_commit = COALESCE(EXCLUDED.is_merge_commit, commits.is_merge_commit),
          html_url = COALESCE(EXCLUDED.html_url, commits.html_url),
          updated_at = NOW()`,
        [
          commit.sha,
          commit.repoOwner,
          commit.repoName,
          commit.authorUsername ?? null,
          commit.authorDate ?? null,
          commit.committerDate ?? null,
          commit.message ?? null,
          JSON.stringify(commit.parentShas ?? []),
          commit.originalPrNumber ?? null,
          commit.originalPrTitle ?? null,
          commit.originalPrUrl ?? null,
          commit.prApproved ?? null,
          commit.prApprovalReason ?? null,
          commit.isMergeCommit ?? false,
          commit.htmlUrl ?? null,
        ],
      )
    }

    await client.query('COMMIT')
    return commits.length
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Get a commit by SHA
 */
async function getCommit(repoOwner: string, repoName: string, sha: string): Promise<Commit | null> {
  const result = await pool.query(`SELECT * FROM commits WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3`, [
    repoOwner,
    repoName,
    sha,
  ])
  return result.rows[0] || null
}

/**
 * Update PR verification result for a commit
 */
export async function updateCommitPrVerification(
  repoOwner: string,
  repoName: string,
  sha: string,
  prNumber: number | null,
  prTitle: string | null,
  prUrl: string | null,
  approved: boolean,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE commits SET
      original_pr_number = $4,
      original_pr_title = $5,
      original_pr_url = $6,
      pr_approved = $7,
      pr_approval_reason = $8,
      updated_at = NOW()
     WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3`,
    [repoOwner, repoName, sha, prNumber, prTitle, prUrl, approved, reason],
  )
}

/**
 * Check if we have commits cached for a range
 */
async function hasCommitsCached(repoOwner: string, repoName: string, sha: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM commits WHERE repo_owner = $1 AND repo_name = $2 AND sha = $3 LIMIT 1`,
    [repoOwner, repoName, sha],
  )
  return result.rows.length > 0
}
