import { describe, expect, it } from 'vitest'
import type { PrCommit, PrMetadata, PrReview, VerificationInput } from '../verification/types'
import { verifyDeployment, verifyFourEyesFromPrData } from '../verification/verify'

function makePrCommit(overrides: Partial<PrCommit> = {}): PrCommit {
  return {
    sha: 'default-commit-sha',
    message: 'Default commit message',
    authorUsername: 'developer-a',
    authorDate: '2026-02-27T12:00:00Z',
    committerDate: '2026-02-27T12:00:00Z',
    isMergeCommit: false,
    parentShas: [],
    ...overrides,
  }
}

function makePrReview(overrides: Partial<PrReview> = {}): PrReview {
  return {
    id: 1,
    username: 'reviewer-b',
    state: 'APPROVED',
    submittedAt: '2026-02-27T13:00:00Z',
    body: null,
    ...overrides,
  }
}

function makePrMetadata(overrides: Partial<PrMetadata> = {}): PrMetadata {
  return {
    number: 100,
    title: 'Test PR',
    body: null,
    state: 'closed',
    merged: true,
    draft: false,
    createdAt: '2026-02-27T10:00:00Z',
    updatedAt: '2026-02-27T14:00:00Z',
    mergedAt: '2026-02-27T14:00:00Z',
    closedAt: '2026-02-27T14:00:00Z',
    baseBranch: 'main',
    baseSha: 'base-sha-000',
    headBranch: 'feature/test',
    headSha: 'head-sha-000',
    mergeCommitSha: 'merge-sha-000',
    author: { username: 'developer-a' },
    mergedBy: { username: 'reviewer-b' },
    labels: [],
    commitsCount: 1,
    changedFiles: 1,
    additions: 5,
    deletions: 2,
    ...overrides,
  }
}

function makeBaseInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    deploymentId: 1000,
    commitSha: 'deploy-sha-1000',
    repository: 'navikt/test-app',
    environmentName: 'prod-fss',
    baseBranch: 'main',
    repositoryStatus: 'active',
    commitOnBaseBranch: true,
    auditStartYear: 2025,
    implicitApprovalSettings: { mode: 'off' },
    previousDeployment: {
      id: 999,
      commitSha: 'deploy-sha-999',
      createdAt: '2026-02-26T10:00:00Z',
    },
    deployedPr: null,
    commitsBetween: [],
    compareSummary: null,
    dataFreshness: {
      deployedPrFetchedAt: new Date('2026-02-28T10:00:00Z'),
      commitsFetchedAt: new Date('2026-02-28T10:00:00Z'),
      schemaVersion: 2,
    },
    ...overrides,
  }
}

describe('verifyDeployment - Case 1: pending_baseline', () => {
  it('should return pending_baseline when there is no previous deployment', () => {
    const input = makeBaseInput({ previousDeployment: null })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(0)
    expect(result.approvalDetails.method).toBe('pending_baseline')
  })

  it('should still include deployed PR info when pending_baseline', () => {
    const input = makeBaseInput({
      previousDeployment: null,
      deployedPr: {
        number: 100,
        url: 'https://github.com/navikt/test-app/pull/100',
        metadata: makePrMetadata(),
        reviews: [makePrReview()],
        commits: [makePrCommit()],
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
    expect(result.deployedPr).not.toBeNull()
    expect(result.deployedPr?.number).toBe(100)
  })
})

describe('verifyDeployment - Case 2a: no_changes (same commit SHA)', () => {
  it('should return no_changes when commitsBetween is empty and SHAs match', () => {
    const input = makeBaseInput({
      commitSha: 'same-sha-abc',
      previousDeployment: {
        id: 999,
        commitSha: 'same-sha-abc',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
    expect(result.unverifiedCommits).toHaveLength(0)
    expect(result.approvalDetails.method).toBe('no_changes')
  })

  it('should still include deployed PR info when no_changes', () => {
    const input = makeBaseInput({
      commitSha: 'same-sha-abc',
      previousDeployment: {
        id: 999,
        commitSha: 'same-sha-abc',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      deployedPr: {
        number: 100,
        url: 'https://github.com/navikt/test-app/pull/100',
        metadata: makePrMetadata(),
        reviews: [makePrReview()],
        commits: [makePrCommit()],
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.deployedPr).not.toBeNull()
  })
})

describe('verifyDeployment - Case 2b: zero-commit handling', () => {
  it('should return no_changes when compare.status=identical (explicit match)', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-same',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-same',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareSummary: {
        status: 'identical',
        aheadBy: 0,
        behindBy: 0,
        totalCommits: 0,
        changedFiles: 0,
        noDiffDetected: true,
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.reason).toContain('GitHub compare reported identical refs/commit')
  })

  it('should return no_changes when compare metadata confirms no diff (diverged but identical trees)', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareSummary: {
        status: 'diverged',
        aheadBy: 0,
        behindBy: 0,
        totalCommits: 0,
        changedFiles: 0,
        noDiffDetected: true, // Tree comparison confirmed identical
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.reason).toContain('GitHub compare returned 0 commits and 0 changed files')
  })

  it('should recognize diverged branches with no actual diff (tree comparison worked)', () => {
    const input = makeBaseInput({
      commitSha: 'branch-x-tip',
      previousDeployment: {
        id: 999,
        commitSha: 'branch-y-tip',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareSummary: {
        status: 'diverged',
        aheadBy: 0,
        behindBy: 0,
        totalCommits: 0,
        changedFiles: 0,
        noDiffDetected: true, // Tree check confirmed both commits wrap same tree
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
  })

  it('should return error when SHAs differ but commitsBetween is empty and no compare metadata', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      // No compareSummary
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('Commit SHAs differ')
    expect(result.approvalDetails.reason).toContain('0 commits')
  })

  it('should return error when SHAs differ and tree comparison found real diff', () => {
    const input = makeBaseInput({
      commitSha: 'older-sha-abc',
      previousDeployment: {
        id: 999,
        commitSha: 'newer-sha-xyz',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareSummary: {
        status: 'diverged',
        aheadBy: 0,
        behindBy: 1,
        totalCommits: 0,
        changedFiles: 0,
        noDiffDetected: false, // Tree comparison found different trees
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('Commit SHAs differ')
  })

  it('should return error for rollback scenario (older commit deployed after newer)', () => {
    const input = makeBaseInput({
      commitSha: '6ebced4f706d932c617212ef01fbc8be06bdbc6c',
      previousDeployment: {
        id: 998,
        commitSha: '2c2b64200000000000000000000000000000000a',
        createdAt: '2026-06-26T14:55:00Z',
      },
      commitsBetween: [],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
  })

  it('should return error with GitHub App message when compareFailed is true', () => {
    const input = makeBaseInput({
      commitsBetween: [],
      compareFailed: true,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('GitHub compare API failed')
    expect(result.approvalDetails.reason).toContain('GitHub App')
  })

  it('should prioritize compareFailed over SHA comparison', () => {
    const input = makeBaseInput({
      commitSha: 'same-sha',
      previousDeployment: {
        id: 999,
        commitSha: 'same-sha',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareFailed: true,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.approvalDetails.reason).toContain('GitHub compare API failed')
  })
})

describe('verifyDeployment - GitHub API and access failures', () => {
  it('should return error when GitHub compare API fails with 403 (access denied)', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareFailed: true,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('GitHub compare API failed')
    expect(result.approvalDetails.reason).toContain('GitHub App')
  })

  it('should return error when GitHub compare API fails with 404 (repo not found)', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareFailed: true,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    // Same message for both 403 and 404 — both are access/configuration issues
  })

  it('should return error when GitHub compare API fails with 500 (server error)', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareFailed: true,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('GitHub compare API failed')
  })

  it('should return error when tree comparison fallback also fails', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      compareSummary: {
        status: 'diverged',
        aheadBy: 0,
        behindBy: 0,
        totalCommits: 0,
        changedFiles: 0,
        noDiffDetected: false, // Tree fallback failed or found diff
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('Commit SHAs differ')
  })

  it('should return no_changes when nearby approved deploy with same commit exists', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      nearbyApprovedDeployWithSameCommit: {
        deploymentId: 1001,
        status: 'approved',
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.reason).toContain('nearby deployment #1001')
    expect(result.approvalDetails.reason).toContain('retry/duplicate')
  })

  it('should still return error when no nearby approved deploy exists', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      // No nearbyApprovedDeployWithSameCommit and no nearbyApprovedDeploy
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('error')
    expect(result.hasFourEyes).toBe(false)
  })

  it('should return no_changes when superseded by nearby approved deploy (ancestor scenario)', () => {
    const input = makeBaseInput({
      commitSha: 'ec3489c',
      previousDeployment: {
        id: 10450,
        commitSha: 'ab169e8',
        createdAt: '2026-02-19T07:46:34Z',
      },
      commitsBetween: [],
      nearbyApprovedDeploy: {
        deploymentId: 10450,
        commitSha: 'ab169e8',
        status: 'approved',
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.reason).toContain('Superseded deploy')
    expect(result.approvalDetails.reason).toContain('#10450')
    expect(result.approvalDetails.reason).toContain('ab169e8')
  })

  it('should prefer same-commit sibling over superseded deploy', () => {
    const input = makeBaseInput({
      commitSha: 'deploy-sha-new',
      previousDeployment: {
        id: 999,
        commitSha: 'deploy-sha-old',
        createdAt: '2026-02-26T10:00:00Z',
      },
      commitsBetween: [],
      nearbyApprovedDeployWithSameCommit: {
        deploymentId: 1001,
        status: 'approved',
      },
      nearbyApprovedDeploy: {
        deploymentId: 1002,
        commitSha: 'other-sha',
        status: 'approved',
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.approvalDetails.reason).toContain('retry/duplicate')
    expect(result.approvalDetails.reason).not.toContain('Superseded')
  })
})

describe('verifyDeployment - Case 5: base branch merge approval', () => {
  it('should return approved when unverified commits are explained by base merge', () => {
    const input = makeBaseInput({
      deployedPr: {
        number: 200,
        url: 'https://github.com/navikt/test-app/pull/200',
        metadata: makePrMetadata({
          number: 200,
          mergeCommitSha: 'deploy-sha-1000',
          author: { username: 'developer-a' },
          mergedBy: { username: 'developer-a' }, // Same as commit author — merger path won't help
        }),
        reviews: [makePrReview({ submittedAt: '2026-02-25T10:00:00Z' })],
        commits: [
          makePrCommit({
            sha: 'feature-commit-1',
            authorUsername: 'developer-a',
            authorDate: '2026-02-25T09:00:00Z',
            message: 'Feature work',
          }),
          makePrCommit({
            sha: 'from-main-1',
            authorUsername: 'other-dev',
            authorDate: '2026-02-25T11:00:00Z',
            message: 'Other feature from main',
          }),
          makePrCommit({
            sha: 'base-merge-commit',
            authorUsername: 'developer-a',
            authorDate: '2026-02-25T12:00:00Z',
            message: "Merge branch 'main' into feature/test",
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'feature-commit-1',
          message: 'Feature work',
          authorUsername: 'developer-a',
          authorDate: '2026-02-25T09:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
        {
          sha: 'from-main-1',
          message: 'Other feature from main',
          authorUsername: 'other-dev',
          authorDate: '2026-02-25T11:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
        {
          sha: 'base-merge-commit',
          message: "Merge branch 'main' into feature/test",
          authorUsername: 'developer-a',
          authorDate: '2026-02-25T12:00:00Z',
          isMergeCommit: true,
          parentShas: ['p1', 'p2'],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('approved')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.method).toBe('base_merge')
    expect(result.unverifiedCommits).toHaveLength(0)
  })
})

describe('verifyDeployment - Case 6: implicit approval mode all', () => {
  it('should return implicitly_approved when merger differs from creator and last committer', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'all' },
      deployedPr: {
        number: 300,
        url: 'https://github.com/navikt/test-app/pull/300',
        metadata: makePrMetadata({
          number: 300,
          mergeCommitSha: 'squash-sha-300',
          author: { username: 'developer-a' },
          mergedBy: { username: 'merger-c' },
        }),
        reviews: [], // No reviews — implicit approval kicks in
        commits: [
          makePrCommit({
            sha: 'commit-in-pr',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T12:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-300',
          message: 'Feature (#300)',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T13:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('implicitly_approved')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.method).toBe('implicit')
    expect(result.approvalDetails.approvers).toContain('merger-c')
  })

  it('should NOT implicitly approve when merger is same as creator', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'all' },
      deployedPr: {
        number: 301,
        url: 'https://github.com/navikt/test-app/pull/301',
        metadata: makePrMetadata({
          number: 301,
          mergeCommitSha: 'squash-sha-301',
          author: { username: 'developer-a' },
          mergedBy: { username: 'developer-a' },
        }),
        reviews: [],
        commits: [
          makePrCommit({
            sha: 'commit-in-pr',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T12:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-301',
          message: 'Feature (#301)',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T13:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
  })
})

describe('verifyDeployment - Case 6: implicit approval mode dependabot_only', () => {
  it('should return implicitly_approved for dependabot PR merged by another user', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'dependabot_only' },
      deployedPr: {
        number: 350,
        url: 'https://github.com/navikt/test-app/pull/350',
        metadata: makePrMetadata({
          number: 350,
          mergeCommitSha: 'squash-sha-350',
          author: { username: 'dependabot[bot]' },
          mergedBy: { username: 'human-dev' },
        }),
        reviews: [], // No reviews
        commits: [
          makePrCommit({
            sha: 'dep-commit-sha',
            authorUsername: 'dependabot[bot]',
            authorDate: '2026-02-27T10:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-350',
          message: 'Bump axios from 1.6.0 to 1.7.0 (#350)',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T11:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('implicitly_approved')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.method).toBe('implicit')
    expect(result.approvalDetails.reason).toContain('Dependabot')
  })

  it('should NOT implicitly approve dependabot PR when merged by dependabot itself', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'dependabot_only' },
      deployedPr: {
        number: 351,
        url: 'https://github.com/navikt/test-app/pull/351',
        metadata: makePrMetadata({
          number: 351,
          mergeCommitSha: 'squash-sha-351',
          author: { username: 'dependabot[bot]' },
          mergedBy: { username: 'dependabot[bot]' }, // Same as creator
        }),
        reviews: [],
        commits: [
          makePrCommit({
            sha: 'dep-commit-sha-2',
            authorUsername: 'dependabot[bot]',
            authorDate: '2026-02-27T10:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-351',
          message: 'Bump axios from 1.6.0 to 1.7.0 (#351)',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T11:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
  })
})

describe('verifyDeployment - deployed PR approval before last commit', () => {
  it('should propagate approval_before_last_commit reason for deployed PR commits', () => {
    const input = makeBaseInput({
      deployedPr: {
        number: 400,
        url: 'https://github.com/navikt/test-app/pull/400',
        metadata: makePrMetadata({
          number: 400,
          mergeCommitSha: null,
          headSha: 'late-commit-sha',
          author: { username: 'developer-a' },
          mergedBy: { username: 'developer-a' }, // Same as commit author — merger path won't help
        }),
        reviews: [
          makePrReview({
            username: 'reviewer-b',
            submittedAt: '2026-02-27T11:00:00Z', // Before last commit
          }),
        ],
        commits: [
          makePrCommit({
            sha: 'early-commit-sha',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T10:00:00Z',
          }),
          makePrCommit({
            sha: 'late-commit-sha',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T12:00:00Z', // After approval
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'early-commit-sha',
          message: 'Initial work',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T10:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: 'https://github.com/navikt/test-app/commit/early',
          pr: null,
        },
        {
          sha: 'late-commit-sha',
          message: 'Pushed after approval',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T12:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: 'https://github.com/navikt/test-app/commit/late',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(2)

    for (const commit of result.unverifiedCommits) {
      expect(commit.reason).toBe('approval_before_last_commit')
      expect(commit.prNumber).toBe(400)
    }
  })
})

describe('verifyDeployment - Security: merge-commit bypass', () => {
  it('should flag non-base-branch merge commits without a PR as unverified', () => {
    const input = makeBaseInput({
      commitsBetween: [
        {
          sha: 'normal-commit',
          message: 'Normal feature work',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T10:00:00Z',
          isMergeCommit: false,
          parentShas: ['p1'],
          htmlUrl: '',
          pr: {
            number: 500,
            title: 'Feature PR',
            url: 'https://github.com/navikt/test-app/pull/500',
            reviews: [makePrReview({ submittedAt: '2026-02-27T11:00:00Z' })],
            commits: [makePrCommit({ sha: 'normal-commit', authorDate: '2026-02-27T10:00:00Z' })],
            baseBranch: 'main',
          },
        },
        {
          sha: 'sneaky-merge-commit',
          message: 'Merge feature-x into feature-y',
          authorUsername: 'attacker',
          authorDate: '2026-02-27T12:00:00Z',
          isMergeCommit: true,
          parentShas: ['p1', 'p2'],
          htmlUrl: '',
          pr: null, // No PR for this merge commit
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.unverifiedCommits.some((c) => c.sha === 'sneaky-merge-commit')).toBe(true)
    expect(result.status).toBe('unverified_commits')
  })

  it('should still skip base-branch merge commits (Merge branch main into ...)', () => {
    const input = makeBaseInput({
      commitsBetween: [
        {
          sha: 'feature-commit',
          message: 'Feature work',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T10:00:00Z',
          isMergeCommit: false,
          parentShas: ['p1'],
          htmlUrl: '',
          pr: {
            number: 600,
            title: 'Feature',
            url: 'https://github.com/navikt/test-app/pull/600',
            reviews: [makePrReview({ submittedAt: '2026-02-27T11:00:00Z' })],
            commits: [
              makePrCommit({
                sha: 'feature-commit',
                authorDate: '2026-02-27T10:00:00Z',
                committerDate: '2026-02-27T10:00:00Z',
              }),
            ],
            baseBranch: 'main',
          },
        },
        {
          sha: 'base-merge-sha',
          message: "Merge branch 'main' into feature/something",
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T12:00:00Z',
          isMergeCommit: true,
          parentShas: ['p1', 'p2'],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('approved')
    expect(result.unverifiedCommits).toHaveLength(0)
  })
})

describe('verifyFourEyesFromPrData - Security: date manipulation', () => {
  it('should reject when authorDate is backdated but committerDate reveals truth', () => {
    const result = verifyFourEyesFromPrData({
      reviewers: [
        {
          id: 1,
          username: 'reviewer',
          state: 'APPROVED',
          submittedAt: '2026-02-27T12:00:00Z', // Approval at noon
          body: null,
        },
      ],
      commits: [
        {
          sha: 'honest-commit',
          message: 'Honest work',
          authorUsername: 'developer',
          authorDate: '2026-02-27T10:00:00Z', // Before approval
          committerDate: '2026-02-27T10:00:00Z',
          isMergeCommit: false,
          parentShas: [],
        },
        {
          sha: 'backdated-commit',
          message: 'Sneaky change',
          authorUsername: 'developer',
          authorDate: '2026-02-27T11:00:00Z', // BACKDATED: claims to be before approval
          committerDate: '2026-02-27T14:00:00Z', // TRUTH: actually pushed after approval
          isMergeCommit: false,
          parentShas: [],
        },
      ],
      baseBranch: 'main',
    })

    expect(result.hasFourEyes).toBe(false)
    expect(result.reason).toBe('approval_before_last_commit')
  })
})

describe('verifyDeployment - Repository status validation', () => {
  it('should return unauthorized_repository when repo status is pending_approval', () => {
    const input = makeBaseInput({
      repositoryStatus: 'pending_approval',
      previousDeployment: null,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unauthorized_repository')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('pending_approval')
  })

  it('should return unauthorized_repository when repo status is historical', () => {
    const input = makeBaseInput({
      repositoryStatus: 'historical',
      commitsBetween: [
        {
          sha: 'abc123',
          message: 'feat: some change',
          authorUsername: 'dev-a',
          authorDate: '2026-02-27T12:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unauthorized_repository')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('historical')
  })

  it('should return unauthorized_repository when repo status is unknown', () => {
    const input = makeBaseInput({
      repositoryStatus: 'unknown',
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unauthorized_repository')
    expect(result.hasFourEyes).toBe(false)
  })

  it('should proceed with normal verification when repo status is active', () => {
    const input = makeBaseInput({
      repositoryStatus: 'active',
      previousDeployment: null,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
  })
})

describe('verifyDeployment - Branch validation', () => {
  it('should return unauthorized_branch when commit is not on base branch', () => {
    const input = makeBaseInput({
      commitOnBaseBranch: false,
      commitsBetween: [
        {
          sha: 'abc123',
          message: 'feat: new feature',
          authorUsername: 'dev-a',
          authorDate: '2026-02-27T12:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unauthorized_branch')
    expect(result.hasFourEyes).toBe(false)
    expect(result.approvalDetails.reason).toContain('base branch')
  })

  it('should proceed with normal verification when commit is on base branch', () => {
    const input = makeBaseInput({
      commitOnBaseBranch: true,
      previousDeployment: null,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
  })

  it('should proceed with normal verification when branch check is unknown (fail-open)', () => {
    const input = makeBaseInput({
      commitOnBaseBranch: null,
      previousDeployment: null,
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
  })
})
