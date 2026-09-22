import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockPaginate = vi.fn()
const mockListReviews = vi.fn()
const mockListComments = vi.fn()
const mockListReviewComments = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: { get: mockReposGet },
    pulls: { listReviews: mockListReviews, listReviewComments: mockListReviewComments },
    issues: { listComments: mockListComments },
    paginate: mockPaginate,
  }),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('~/db/github-data.server', () => ({
  saveCommitAssociatedPrsRawSnapshot: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
}))

import { getMutablePrDataFromGitHub } from '~/lib/github/pr.server'

describe('getMutablePrDataFromGitHub includeComments', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockPaginate.mockReset()
    mockReposGet.mockResolvedValue({ data: { id: 42 } })
    mockPaginate.mockImplementation((method) => {
      if (method === mockListReviews) return Promise.resolve([{ id: 1, state: 'APPROVED' }])
      throw new Error(`Unexpected paginate call for method: ${method}`)
    })
  })

  it('does not call the comment endpoints and returns null for both fields when includeComments is false', async () => {
    const result = await getMutablePrDataFromGitHub('navikt', 'nda', 100, false)

    expect(mockPaginate).toHaveBeenCalledTimes(1)
    expect(mockPaginate).toHaveBeenCalledWith(mockListReviews, expect.anything(), expect.any(Function))
    expect(result?.issueComments).toBeNull()
    expect(result?.reviewComments).toBeNull()
    expect(result?.reviews).toEqual([{ id: 1, state: 'APPROVED' }])
  })

  it('fetches both comment endpoints and returns arrays when includeComments is true (default)', async () => {
    mockPaginate.mockImplementation((method) => {
      if (method === mockListReviews) return Promise.resolve([{ id: 1, state: 'APPROVED' }])
      if (method === mockListComments) return Promise.resolve([{ id: 2, body: 'a comment' }])
      if (method === mockListReviewComments) return Promise.resolve([{ id: 3, body: 'a review comment' }])
      throw new Error(`Unexpected paginate call for method: ${method}`)
    })

    const result = await getMutablePrDataFromGitHub('navikt', 'nda', 100)

    expect(mockPaginate).toHaveBeenCalledTimes(3)
    expect(result?.issueComments).toEqual([{ id: 2, body: 'a comment' }])
    expect(result?.reviewComments).toEqual([{ id: 3, body: 'a review comment' }])
  })

  it('does not call the reviews endpoint and returns null for reviews when includeReviews is false', async () => {
    mockPaginate.mockImplementation((method) => {
      if (method === mockListComments) return Promise.resolve([{ id: 2, body: 'a comment' }])
      if (method === mockListReviewComments) return Promise.resolve([{ id: 3, body: 'a review comment' }])
      throw new Error(`Unexpected paginate call for method: ${method}`)
    })

    const result = await getMutablePrDataFromGitHub('navikt', 'nda', 100, true, false)

    expect(mockPaginate).toHaveBeenCalledTimes(2)
    expect(mockPaginate).not.toHaveBeenCalledWith(mockListReviews, expect.anything(), expect.any(Function))
    expect(result?.reviews).toBeNull()
    expect(result?.issueComments).toEqual([{ id: 2, body: 'a comment' }])
    expect(result?.reviewComments).toEqual([{ id: 3, body: 'a review comment' }])
  })
})
