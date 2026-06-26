import type { VerificationInput } from './types'

type CommitBetween = VerificationInput['commitsBetween'][number]

export function buildBranchMismatch(
  deployedPr: VerificationInput['deployedPr'],
  deployedPrMismatchedBranches: string[],
  deployedPrMismatchedPrNumbers: number[],
  commitsBetween: CommitBetween[],
  baseBranch: string,
): VerificationInput['branchMismatch'] {
  const mismatchedSet = new Map<string, Set<number>>()

  if (deployedPr === null) {
    for (let i = 0; i < deployedPrMismatchedBranches.length; i++) {
      const branch = deployedPrMismatchedBranches[i]
      const prNumber = deployedPrMismatchedPrNumbers[i]
      if (!mismatchedSet.has(branch)) mismatchedSet.set(branch, new Set())
      mismatchedSet.get(branch)?.add(prNumber)
    }

    for (const commit of commitsBetween) {
      if (commit.pr) continue
      if (commit.mismatchedBaseBranches) {
        for (let i = 0; i < commit.mismatchedBaseBranches.length; i++) {
          const branch = commit.mismatchedBaseBranches[i]
          const prNumber = commit.mismatchedPrNumbers?.[i]
          if (prNumber == null) continue
          if (!mismatchedSet.has(branch)) mismatchedSet.set(branch, new Set())
          mismatchedSet.get(branch)?.add(prNumber)
        }
      }
    }
  }

  if (mismatchedSet.size === 0) return undefined

  const detectedBranches = Array.from(mismatchedSet.keys())
  const prNumbers = Array.from(new Set(Array.from(mismatchedSet.values()).flatMap((s) => Array.from(s)))).sort(
    (a, b) => a - b,
  )

  return { expectedBranch: baseBranch, detectedBranches, prNumbers }
}
