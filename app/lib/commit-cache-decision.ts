/**
 * Pure function to decide whether to use a cached commit verification result.
 *
 * Extracted from the V1 verification loop in sync.server.ts for testability.
 * Determines whether to skip a commit (cached as verified), add it as unverified,
 * or recheck via GitHub API.
 */
type CacheDecision = 'skip_verified' | 'add_unverified' | 'recheck'

export function shouldUseCachedCommitResult(
  cachedCommit: {
    pr_approved: boolean | null
    pr_approval_reason: string | null
  },
  forceRecheck: boolean,
): CacheDecision {
  // When manually re-verifying, always recheck via GitHub API
  if (forceRecheck) return 'recheck'

  // No cached result — need to check GitHub API
  if (cachedCommit.pr_approved === null) return 'recheck'

  // Cached as approved — trust the cache
  if (cachedCommit.pr_approved) return 'skip_verified'

  // Cached as not approved with a specific reason (not 'no_pr')
  if (cachedCommit.pr_approval_reason !== 'no_pr') return 'add_unverified'

  // Cached as no_pr — retry with rebase matching
  return 'recheck'
}
