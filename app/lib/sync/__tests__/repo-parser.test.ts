import { describe, expect, it } from 'vitest'
import { parseRepository } from '../repo-parser'

describe('parseRepository', () => {
  describe('owner/repo format (used by syncDeploymentsFromNais)', () => {
    it('parses simple owner/repo', () => {
      expect(parseRepository('navikt/pensjon-pen')).toEqual({ owner: 'navikt', repo: 'pensjon-pen' })
    })

    it('returns null for empty string', () => {
      expect(parseRepository('')).toBeNull()
    })

    it('returns null for null', () => {
      expect(parseRepository(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(parseRepository(undefined)).toBeNull()
    })

    it('returns null for single segment without slash', () => {
      expect(parseRepository('pensjon-pen')).toBeNull()
    })

    it('returns null for three segments (original split check: length !== 2)', () => {
      expect(parseRepository('navikt/pensjon-pen/extra')).toBeNull()
    })
  })

  describe('GitHub URL format (used by syncNewDeploymentsFromNais)', () => {
    it('parses full https URL', () => {
      expect(parseRepository('https://github.com/navikt/pensjon-pen')).toEqual({
        owner: 'navikt',
        repo: 'pensjon-pen',
      })
    })

    it('parses URL with .git suffix', () => {
      expect(parseRepository('https://github.com/navikt/pensjon-pen.git')).toEqual({
        owner: 'navikt',
        repo: 'pensjon-pen',
      })
    })

    it('parses URL without protocol prefix', () => {
      expect(parseRepository('github.com/navikt/pensjon-pen')).toEqual({
        owner: 'navikt',
        repo: 'pensjon-pen',
      })
    })
  })

  describe('edge cases matching original behavior', () => {
    it('simple owner/repo still works when URL parsing fails', () => {
      expect(parseRepository('navikt/deployment-audit')).toEqual({
        owner: 'navikt',
        repo: 'deployment-audit',
      })
    })

    it('returns null for slash-only string', () => {
      expect(parseRepository('/')).toBeNull()
    })

    it('returns null for string with empty segments', () => {
      expect(parseRepository('/repo')).toBeNull()
    })
  })
})
