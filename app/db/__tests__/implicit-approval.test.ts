import { describe, expect, it } from 'vitest'
import { checkImplicitApproval } from '../../lib/verification/verify'
import { DEFAULT_IMPLICIT_APPROVAL_SETTINGS, type ImplicitApprovalSettings } from '../app-settings.server'

describe('checkImplicitApproval', () => {
  const DEPENDABOT_PR = {
    prCreator: 'dependabot[bot]',
    mergedBy: 'developer-a',
    lastCommitAuthor: 'dependabot[bot]',
    allCommitAuthors: ['dependabot[bot]'],
    commitSha: 'c94209111727c9e9b3e6e65839177f03174c280e',
    title: 'Bump isbot from 5.1.32 to 5.1.33',
  }

  const HUMAN_PR = {
    prCreator: 'developer-a',
    mergedBy: 'developer-b',
    lastCommitAuthor: 'developer-a',
    allCommitAuthors: ['developer-a', 'developer-a'],
  }

  const SELF_MERGE_PR = {
    prCreator: 'developer-a',
    mergedBy: 'developer-a',
    lastCommitAuthor: 'developer-a',
    allCommitAuthors: ['developer-a'],
  }

  const MIXED_DEPENDABOT_PR = {
    prCreator: 'dependabot[bot]',
    mergedBy: 'developer-a',
    lastCommitAuthor: 'developer-a', // Human made last commit
    allCommitAuthors: ['dependabot[bot]', 'developer-a'],
  }

  describe('mode = off', () => {
    const settings: ImplicitApprovalSettings = { mode: 'off' }

    it('should not qualify Dependabot PR', () => {
      const result = checkImplicitApproval({
        settings,
        ...DEPENDABOT_PR,
      })
      expect(result.qualifies).toBe(false)
    })

    it('should not qualify human PR', () => {
      const result = checkImplicitApproval({
        settings,
        ...HUMAN_PR,
      })
      expect(result.qualifies).toBe(false)
    })
  })

  describe('mode = dependabot_only', () => {
    const settings: ImplicitApprovalSettings = { mode: 'dependabot_only' }

    it('should qualify Dependabot PR with only Dependabot commits', () => {
      const result = checkImplicitApproval({
        settings,
        ...DEPENDABOT_PR,
      })
      expect(result.qualifies).toBe(true)
      expect(result.reason).toContain('Dependabot')
    })

    it('should NOT qualify regular human PR', () => {
      const result = checkImplicitApproval({
        settings,
        ...HUMAN_PR,
      })
      expect(result.qualifies).toBe(false)
    })

    it('should NOT qualify Dependabot PR with human commits', () => {
      const result = checkImplicitApproval({
        settings,
        ...MIXED_DEPENDABOT_PR,
      })
      expect(result.qualifies).toBe(false)
    })

    it('should NOT qualify if Dependabot merges own PR', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'dependabot[bot]',
        mergedBy: 'dependabot[bot]',
        lastCommitAuthor: 'dependabot[bot]',
        allCommitAuthors: ['dependabot[bot]'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('should handle case-insensitive Dependabot variations', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'dependabot[bot]',
        mergedBy: 'developer-a',
        lastCommitAuthor: 'Dependabot', // Different casing
        allCommitAuthors: ['dependabot'], // Without [bot]
      })
      expect(result.qualifies).toBe(true)
    })
  })

  describe('mode = all', () => {
    const settings: ImplicitApprovalSettings = { mode: 'all' }

    it('should qualify when merger is different from creator and last author', () => {
      const result = checkImplicitApproval({
        settings,
        ...HUMAN_PR,
      })
      expect(result.qualifies).toBe(true)
      expect(result.reason).toContain('developer-b')
      expect(result.reason).toContain('developer-a')
    })

    it('should qualify Dependabot PR (merger different from creator)', () => {
      const result = checkImplicitApproval({
        settings,
        ...DEPENDABOT_PR,
      })
      expect(result.qualifies).toBe(true)
    })

    it('should NOT qualify when merger is the PR creator', () => {
      const result = checkImplicitApproval({
        settings,
        ...SELF_MERGE_PR,
      })
      expect(result.qualifies).toBe(false)
    })

    it('should NOT qualify when merger is the last commit author', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'developer-a',
        mergedBy: 'developer-b',
        lastCommitAuthor: 'developer-b', // Merger made last commit
        allCommitAuthors: ['developer-a', 'developer-b'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('should handle case-insensitive username comparison', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'Developer-A',
        mergedBy: 'developer-a', // Same user, different case
        lastCommitAuthor: 'DEVELOPER-A',
        allCommitAuthors: ['developer-a'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('should qualify when merger is different but not reviewer', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'developer-a',
        mergedBy: 'developer-c',
        lastCommitAuthor: 'developer-a',
        allCommitAuthors: ['developer-a', 'developer-b'],
      })
      expect(result.qualifies).toBe(true)
    })
  })

  describe('default settings', () => {
    it('should default to mode=off', () => {
      expect(DEFAULT_IMPLICIT_APPROVAL_SETTINGS.mode).toBe('off')
    })

    it('should not qualify anything with default settings', () => {
      const result = checkImplicitApproval({
        settings: DEFAULT_IMPLICIT_APPROVAL_SETTINGS,
        ...DEPENDABOT_PR,
      })
      expect(result.qualifies).toBe(false)
    })
  })

  describe('edge cases', () => {
    const settings: ImplicitApprovalSettings = { mode: 'all' }

    it('should handle empty author strings', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: '',
        mergedBy: 'developer-a',
        lastCommitAuthor: '',
        allCommitAuthors: [],
      })
      expect(result.qualifies).toBe(true)
    })

    it('should handle single commit PR', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'developer-a',
        mergedBy: 'developer-b',
        lastCommitAuthor: 'developer-a',
        allCommitAuthors: ['developer-a'],
      })
      expect(result.qualifies).toBe(true)
    })

    it('should handle PR with many commits from different authors', () => {
      const result = checkImplicitApproval({
        settings,
        prCreator: 'developer-a',
        mergedBy: 'developer-d',
        lastCommitAuthor: 'developer-c',
        allCommitAuthors: ['developer-a', 'developer-b', 'developer-c'],
      })
      expect(result.qualifies).toBe(true)
    })
  })
})
