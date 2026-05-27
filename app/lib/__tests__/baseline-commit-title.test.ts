import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/lib/github', () => ({
  getSingleCommitMessage: vi.fn(),
}))

import { getSingleCommitMessage } from '~/lib/github'
import { resolveRawCommitMessage } from '~/lib/verification/fetch-data.server'

const mockGetSingleCommitMessage = getSingleCommitMessage as Mock

beforeEach(() => {
  vi.clearAllMocks()
})

const COMMIT_SHA = 'd6ba02ef2464200efdb76e92fb88ec6069f8e9c0'

function makeCommit(message: string) {
  return {
    sha: 'abc',
    message,
    authorUsername: 'user',
    authorDate: '',
    committerDate: '',
    htmlUrl: '',
    isMergeCommit: false,
    parentShas: [] as string[],
    pr: null,
  }
}

describe('resolveRawCommitMessage', () => {
  it('returns undefined when there is a deployed PR', async () => {
    const result = await resolveRawCommitMessage({
      deployedPr: { number: 1, url: '', metadata: {} as never, reviews: [], commits: [] },
      commitsBetween: [makeCommit('feat: something')],
      previousDeployment: null,
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })
    expect(result).toBeUndefined()
    expect(mockGetSingleCommitMessage).not.toHaveBeenCalled()
  })

  it('returns first commit message from commitsBetween when available', async () => {
    const result = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [makeCommit('fix: bug\n\nmore details'), makeCommit('chore: other')],
      previousDeployment: { id: 100, commitSha: 'prev', createdAt: '' },
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })
    expect(result).toBe('fix: bug\n\nmore details')
    expect(mockGetSingleCommitMessage).not.toHaveBeenCalled()
  })

  it('calls getSingleCommitMessage for baseline (no PR, no previousDeployment, empty commitsBetween)', async () => {
    mockGetSingleCommitMessage.mockResolvedValue('Update image tag generation.\n\nMore details.')

    const result = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [],
      previousDeployment: null,
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })

    expect(mockGetSingleCommitMessage).toHaveBeenCalledWith('navikt', 'afp-offentlig', COMMIT_SHA)
    expect(result).toBe('Update image tag generation.\n\nMore details.')
  })

  it('returns undefined when getSingleCommitMessage returns null (error/404)', async () => {
    mockGetSingleCommitMessage.mockResolvedValue(null)

    const result = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [],
      previousDeployment: null,
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })

    expect(result).toBeUndefined()
  })

  it('does not call getSingleCommitMessage when previousDeployment exists but commitsBetween is empty', async () => {
    const result = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [],
      previousDeployment: { id: 100, commitSha: 'prev', createdAt: '' },
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })

    expect(mockGetSingleCommitMessage).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })
})

describe('detectedTitle derivation from resolveRawCommitMessage', () => {
  it('uses only the first line of the commit message', async () => {
    mockGetSingleCommitMessage.mockResolvedValue('feat: add feature\n\nThis is the body.')

    const raw = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [],
      previousDeployment: null,
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })
    const title = raw ? raw.split('\n')[0].trim().slice(0, 500) || undefined : undefined

    expect(title).toBe('feat: add feature')
  })

  it('caps title at 500 characters', async () => {
    mockGetSingleCommitMessage.mockResolvedValue('A'.repeat(600))

    const raw = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [],
      previousDeployment: null,
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })
    const title = raw ? raw.split('\n')[0].trim().slice(0, 500) || undefined : undefined

    expect(title).toHaveLength(500)
  })

  it('returns undefined for whitespace-only commit message', async () => {
    mockGetSingleCommitMessage.mockResolvedValue('   \n\n  ')

    const raw = await resolveRawCommitMessage({
      deployedPr: null,
      commitsBetween: [],
      previousDeployment: null,
      owner: 'navikt',
      repo: 'afp-offentlig',
      commitSha: COMMIT_SHA,
    })
    const title = raw ? raw.split('\n')[0].trim().slice(0, 500) || undefined : undefined

    expect(title).toBeUndefined()
  })
})
