const MIN_COMMIT_SHA_LENGTH = 7

export const VALID_COMMIT_SHA_SQL = `d.commit_sha !~ '^refs/' AND LENGTH(d.commit_sha) >= ${MIN_COMMIT_SHA_LENGTH}`

export function isValidCommitSha(sha: string): boolean {
  return !sha.startsWith('refs/') && sha.length >= MIN_COMMIT_SHA_LENGTH
}
