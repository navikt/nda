import { describe, expect, it } from 'vitest'
import { buildBranchMismatch } from '../verification/branch-mismatch'
import type { VerificationInput } from '../verification/types'

type CommitBetween = VerificationInput['commitsBetween'][number]

const SANDBOX_COMMIT: CommitBetween = {
  sha: 'sha-sandbox-001',
  message: 'Log warning instead of error when 403 from representasjon.',
  authorUsername: 'r154508',
  authorDate: '2026-06-11T14:05:30Z',
  isMergeCommit: false,
  parentShas: ['sha-parent-001'],
  htmlUrl: 'https://github.com/navikt/pensjon-psak/commit/sha-sandbox-001',
  pr: null,
  mismatchedBaseBranches: ['sandbox'],
  mismatchedPrNumbers: [3262],
}

describe('buildBranchMismatch', () => {
  describe('when deployedPr is null (no valid main-targeting PR for deployment commit)', () => {
    it('sets branchMismatch from in-range commits with mismatched branches', () => {
      const result = buildBranchMismatch(null, [], [], [SANDBOX_COMMIT], 'main')

      expect(result).toEqual({
        expectedBranch: 'main',
        detectedBranches: ['sandbox'],
        prNumbers: [3262],
      })
    })

    it('sets branchMismatch from deployed PR lookup mismatch', () => {
      const result = buildBranchMismatch(null, ['sandbox'], [3262], [], 'main')

      expect(result).toEqual({
        expectedBranch: 'main',
        detectedBranches: ['sandbox'],
        prNumbers: [3262],
      })
    })

    it('skips in-range commits that already have a valid main-targeting PR', () => {
      const verifiedCommit: CommitBetween = {
        ...SANDBOX_COMMIT,
        pr: {
          number: 3261,
          title: 'Fix error handling',
          url: 'https://github.com/navikt/pensjon-psak/pull/3261',
          reviews: [],
          commits: [],
          baseBranch: 'main',
        },
      }
      const result = buildBranchMismatch(null, [], [], [verifiedCommit], 'main')

      expect(result).toBeUndefined()
    })
  })

  describe('when deployedPr exists (deployment commit has a valid main-targeting PR)', () => {
    const deployedPr: VerificationInput['deployedPr'] = {
      number: 3257,
      url: 'https://github.com/navikt/pensjon-psak/pull/3257',
      metadata: {} as VerificationInput['deployedPr'] extends { metadata: infer M } | null ? M : never,
      reviews: [],
      commits: [],
    }

    it('does not set branchMismatch even when in-range commits have mismatched sandbox branches', () => {
      const result = buildBranchMismatch(deployedPr, [], [], [SANDBOX_COMMIT], 'main')

      expect(result).toBeUndefined()
    })

    it('does not set branchMismatch when multiple in-range commits have mismatched branches', () => {
      const anotherSandboxCommit: CommitBetween = {
        ...SANDBOX_COMMIT,
        sha: 'sha-sandbox-002',
        mismatchedPrNumbers: [3265],
      }
      const result = buildBranchMismatch(deployedPr, [], [], [SANDBOX_COMMIT, anotherSandboxCommit], 'main')

      expect(result).toBeUndefined()
    })

    it('does not set branchMismatch from deployed PR mismatch data when deployedPr exists', () => {
      const result = buildBranchMismatch(deployedPr, ['sandbox'], [3262], [], 'main')

      expect(result).toBeUndefined()
    })
  })
})
