/**
 * Minimum length for a commit SHA to be considered valid for verification.
 *
 * Git's default short SHA length is 7 characters. Values shorter than this
 * are likely corrupted data or non-SHA identifiers, not resolvable commit refs.
 */
const MIN_COMMIT_SHA_LENGTH = 7

/** SQL fragment for filtering valid commit SHAs in queries (requires table alias `d`). */
export const VALID_COMMIT_SHA_SQL = `d.commit_sha !~ '^refs/' AND LENGTH(d.commit_sha) >= ${MIN_COMMIT_SHA_LENGTH}`

/** Check whether a commit SHA string is valid for verification (not a ref, not too short). */
export function isValidCommitSha(sha: string): boolean {
  return !sha.startsWith('refs/') && sha.length >= MIN_COMMIT_SHA_LENGTH
}
