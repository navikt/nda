type CacheDecision = 'skip_verified' | 'add_unverified' | 'recheck'

export function shouldUseCachedCommitResult(
  cachedCommit: {
    pr_approved: boolean | null
    pr_approval_reason: string | null
  },
  forceRecheck: boolean,
): CacheDecision {
  if (forceRecheck) return 'recheck'

  if (cachedCommit.pr_approved === null) return 'recheck'

  if (cachedCommit.pr_approved) return 'skip_verified'

  if (cachedCommit.pr_approval_reason !== 'no_pr') return 'add_unverified'

  return 'recheck'
}
