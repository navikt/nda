import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  lock: vi.fn(),
  root: vi.fn(),
  blocks: vi.fn(),
  defer: vi.fn(),
  fetch: vi.fn(),
  verify: vi.fn(),
  store: vi.fn(),
  checks: vi.fn(),
  cache: vi.fn(),
  propagate: vi.fn(),
  prepare: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mocks.query },
  withTransaction: vi.fn(async (run) => run({ query: mocks.query })),
}))
vi.mock('~/db/sibling-verification.server', async (original) => ({
  ...(await original<object>()),
  lockSiblingWork: mocks.lock,
  isCurrentSiblingRoot: mocks.root,
  isBlockingSiblingCandidate: mocks.blocks,
  deferSiblingWork: mocks.defer,
}))
vi.mock('~/db/monorepo.server', () => ({ propagateVerificationToSiblings: mocks.propagate }))
vi.mock('~/lib/github/client.server', () => ({ getGitHubRetryAt: mocks.reset }))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/verification/fetch-data.server', () => ({ fetchVerificationData: mocks.fetch }))
vi.mock('~/lib/verification/verify', () => ({ verifyDeployment: mocks.verify }))
vi.mock('~/lib/verification/index', () => ({ applyPassthroughFields: vi.fn() }))
vi.mock('~/lib/verification/store-data.server', () => ({
  storeVerificationResult: mocks.store,
  updateDeploymentCommitChecks: mocks.checks,
  updateCommitCache: mocks.cache,
  prepareVerificationPrData: mocks.prepare,
}))

import type { SiblingWork } from '~/db/sibling-verification.server'
import { siblingRetryDelay } from '~/db/sibling-verification.server'
import { buildSiblingBasis, runSiblingVerification, siblingDeferUntil } from '~/lib/verification/sibling-retry.server'
import type { VerificationInput, VerificationResult } from '~/lib/verification/types'

const work: SiblingWork = {
  id: 20,
  monitored_app_id: 2,
  repository_id: 1,
  verification_repository_id: 1,
  commit_sha: 'b'.repeat(40),
  created_at: '2026-01-02 00:00:00.123456+00',
  four_eyes_status: 'pending_sibling_resolution',
  environment_name: 'prod-gcp',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'example',
  default_branch: 'main',
  trigger_url: null,
  sibling_wait_candidate_id: 10,
  sibling_wait_basis: null,
  sibling_wait_checked_at: null,
  sibling_next_attempt_at: null,
  sibling_refresh_after: null,
  sibling_retry_count: 0,
  decision_signature: null,
}

const input: VerificationInput = {
  deploymentId: work.id,
  monitoredAppId: work.monitored_app_id,
  commitSha: work.commit_sha,
  repository: 'navikt/example',
  environmentName: 'prod-gcp',
  baseBranch: 'main',
  repositoryStatus: 'active',
  commitOnBaseBranch: true,
  auditStartYear: null,
  implicitApprovalSettings: { mode: 'off' },
  previousDeployment: {
    id: 10,
    monitoredAppId: 1,
    commitSha: work.commit_sha,
    createdAt: '2026-01-01T00:00:00Z',
    fourEyesStatus: 'unverified_commits',
  },
  deployedPr: null,
  commitsBetween: [],
  compareSummary: null,
  dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 5 },
  commitChecksAttempted: true,
}

const result: VerificationResult = {
  status: 'pending_sibling_resolution',
  hasFourEyes: false,
  deployedPr: null,
  unverifiedCommits: [],
  approvalDetails: { method: null, approvers: [], reason: 'Waiting for sibling' },
  verifiedAt: new Date('2026-01-02T00:00:00Z'),
  schemaVersion: 5,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.fetch.mockResolvedValue(structuredClone(input))
  mocks.verify.mockReturnValue(structuredClone(result))
  mocks.lock.mockResolvedValue(true)
  mocks.root.mockResolvedValue(true)
  mocks.blocks.mockResolvedValue(true)
  mocks.prepare.mockResolvedValue(null)
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 })
})

it('deduplicates unchanged waiting decisions but keeps checks and retry state fresh', async () => {
  const basis = buildSiblingBasis(work, input, result)
  expect(await runSiblingVerification({ ...work, decision_signature: basis.decision })).toBe('unchanged')
  expect(mocks.fetch).toHaveBeenCalledWith(
    20,
    work.commit_sha,
    'navikt/example',
    'prod-gcp',
    'main',
    2,
    { forceRefresh: true, includeComments: false },
    null,
    1,
  )
  expect(mocks.store).not.toHaveBeenCalled()
  expect(mocks.checks).toHaveBeenCalledWith(20, undefined, true, expect.objectContaining({ query: mocks.query }))
  expect(mocks.propagate).not.toHaveBeenCalled()
})

it('stores changed basis atomically with the retry state using the transaction client', async () => {
  expect(await runSiblingVerification(work)).toBe('applied')
  expect(mocks.store).toHaveBeenCalledWith(
    20,
    result,
    { prSnapshotIds: [], commitSnapshotIds: [] },
    input,
    'sibling_reverification',
    undefined,
    { executor: { query: mocks.query }, githubPrDataJson: null },
  )
  expect(mocks.query).toHaveBeenCalledOnce()
})

it('ignores observation timestamps and checks in the decision signature', () => {
  expect(buildSiblingBasis(work, input, result)).toEqual(
    buildSiblingBasis(work, input, {
      ...result,
      verifiedAt: new Date(),
      commitChecksAttempted: true,
      commitChecks: { checked_sha: work.commit_sha, checks_passed: false, checks: [] },
    }),
  )
  expect(buildSiblingBasis(work, { ...input, baseBranch: 'other' }, result).decision).not.toBe(
    buildSiblingBasis(work, input, result).decision,
  )
})

it('keeps configured branch and live verification branch distinct in the stored basis', () => {
  const basis = buildSiblingBasis(work, { ...input, baseBranch: 'master' }, result)
  expect(basis.configuredBaseBranch).toBe('main')
  expect(basis.baseBranch).toBe('master')
  expect(basis.decision).not.toBe(buildSiblingBasis(work, input, result).decision)
})

it('discards stale work without history, cache updates or propagation', async () => {
  mocks.lock.mockResolvedValue(false)
  expect(await runSiblingVerification(work)).toBe('stale')
  expect(mocks.store).not.toHaveBeenCalled()
  expect(mocks.query).not.toHaveBeenCalled()
  expect(mocks.cache).not.toHaveBeenCalled()
  expect(mocks.propagate).not.toHaveBeenCalled()
})

it('revalidates and locks the actual root before applying derived approval', async () => {
  mocks.fetch.mockResolvedValue({
    ...input,
    previousDeployment: { ...input.previousDeployment, fourEyesStatus: 'approved' },
  })
  mocks.verify.mockReturnValue({ ...result, status: 'verified_via_sibling', hasFourEyes: true })
  mocks.root.mockResolvedValue(false)
  expect(await runSiblingVerification(work)).toBe('stale')
  expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), work, 10)
  expect(mocks.store).not.toHaveBeenCalled()
  expect(mocks.propagate).not.toHaveBeenCalled()
})

it('never accepts a derived or negative sibling as a root', async () => {
  mocks.verify.mockReturnValue({ ...result, status: 'verified_via_sibling', hasFourEyes: true })
  expect(await runSiblingVerification(work)).toBe('deferred')
  expect(mocks.lock).not.toHaveBeenCalled()
  expect(mocks.store).not.toHaveBeenCalled()
})

it('allows independently approved commit reviews without a sibling root', async () => {
  mocks.verify.mockReturnValue({ ...result, status: 'approved', hasFourEyes: true })
  expect(await runSiblingVerification(work)).toBe('applied')
  expect(mocks.root).not.toHaveBeenCalled()
})

it.each(['error', 'pending_baseline', 'pending_sibling_resolution'] as const)(
  'preserves a blocking negative candidate when the verifier returns %s',
  async (status) => {
    mocks.verify.mockReturnValue({ ...result, status })
    const candidate = { ...work, four_eyes_status: 'unverified_commits' }
    expect(await runSiblingVerification(candidate, true)).toBe('deferred')
    expect(mocks.defer).toHaveBeenCalledWith(candidate, true, expect.any(Date), true)
    expect(mocks.store).not.toHaveBeenCalled()
  },
)

it('defers technical fetch failures without replacing operational status', async () => {
  mocks.fetch.mockRejectedValue(new Error('GitHub unavailable'))
  expect(await runSiblingVerification(work)).toBe('deferred')
  expect(mocks.store).not.toHaveBeenCalled()
  expect(mocks.defer).toHaveBeenCalledWith(work, false, expect.any(Date), true)
})

it('does no HTTP work for a candidate that no longer blocks a current waiter', async () => {
  mocks.blocks.mockResolvedValue(false)
  expect(await runSiblingVerification({ ...work, four_eyes_status: 'unverified_commits' }, true)).toBe('stale')
  expect(mocks.fetch).not.toHaveBeenCalled()
})

it('caps normal backoff at one day and technical backoff at one hour', () => {
  expect([0, 1, 2, 3].map((attempts) => siblingRetryDelay(0, attempts))).toEqual([900000, 3600000, 21600000, 86400000])
  expect(siblingRetryDelay(20, 100)).toBe(86400000)
  expect(siblingRetryDelay(20, 100, true)).toBe(3600000)
  const reset = new Date(Date.now() + 7200000)
  mocks.reset.mockReturnValue(reset)
  expect(siblingDeferUntil(work).getTime()).toBe(reset.getTime())
})
