import { beforeEach, expect, it, vi } from 'vitest'

const { mockSaveVerificationRun, mockQuery } = vi.hoisted(() => ({
  mockSaveVerificationRun: vi.fn(),
  mockQuery: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({ pool: { query: mockQuery } }))
vi.mock('~/db/github-data.server', () => ({ saveVerificationRun: mockSaveVerificationRun }))
vi.mock('~/db/deployments.server', () => ({ logStatusTransition: vi.fn() }))
vi.mock('~/db/commits.server', () => ({ updateCommitPrVerification: vi.fn() }))

import { storeVerificationResult } from '~/lib/verification/store-data.server'
import type { VerificationInput, VerificationResult } from '~/lib/verification/types'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const previousDeployment = { id: 2, commitSha: baseSha, createdAt: '2026-01-01T00:00:00Z' }
const result: VerificationResult = {
  hasFourEyes: false,
  status: 'unverified_commits',
  deployedPr: null,
  unverifiedCommits: [],
  approvalDetails: { method: null, approvers: [], reason: 'Ikke godkjent' },
  verifiedAt: new Date('2026-01-02T00:00:00Z'),
  schemaVersion: 5,
}
const snapshotIds = { prSnapshotIds: [1], commitSnapshotIds: [2] }

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveVerificationRun.mockResolvedValue(42)
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
})

it('persists full input SHAs in the run without mutating the verification result', async () => {
  const returned = await storeVerificationResult(3, result, snapshotIds, { commitSha: headSha, previousDeployment })
  expect(returned).toEqual({ verificationRunId: 42 })
  expect(mockSaveVerificationRun).toHaveBeenCalledWith(
    3,
    { status: result.status, result: { ...result, comparisonRange: { baseSha, headSha } } },
    snapshotIds,
  )
  expect(result).not.toHaveProperty('comparisonRange')
})

it('preserves identical base and head for same-SHA comparisons', async () => {
  await storeVerificationResult(3, result, snapshotIds, { commitSha: baseSha, previousDeployment })
  expect(mockSaveVerificationRun.mock.calls[0][1].result.comparisonRange).toEqual({ baseSha, headSha: baseSha })
})

it.each([
  { previousDeployment: null },
  { previousDeployment: { ...previousDeployment, commitSha: '' } },
  { commitSha: '' },
  { previousDeploymentLookupFailed: true },
  { previousDeploymentRateLimited: true },
])('persists no interval when input does not establish both ends: %j', async (override) => {
  const input: Pick<
    VerificationInput,
    'commitSha' | 'previousDeployment' | 'previousDeploymentLookupFailed' | 'previousDeploymentRateLimited'
  > = { commitSha: headSha, previousDeployment, ...override }
  await storeVerificationResult(3, result, snapshotIds, input)
  expect(mockSaveVerificationRun.mock.calls[0][1].result.comparisonRange).toBeNull()
})
