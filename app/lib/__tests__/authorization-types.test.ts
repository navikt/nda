import { describe, expect, it } from 'vitest'
import { isTeamLeaderRole, TEAM_ROLES } from '~/lib/authorization-types'

describe('isTeamLeaderRole', () => {
  it('returns true for produktleder', () => {
    expect(isTeamLeaderRole('produktleder')).toBe(true)
  })

  it('returns true for tech_lead', () => {
    expect(isTeamLeaderRole('tech_lead')).toBe(true)
  })

  it('returns false for utvikler', () => {
    expect(isTeamLeaderRole('utvikler')).toBe(false)
  })

  it('returns false for unknown role', () => {
    expect(isTeamLeaderRole('unknown')).toBe(false)
  })
})

describe('TEAM_ROLES', () => {
  it('includes tech_lead', () => {
    expect(TEAM_ROLES).toContain('tech_lead')
  })

  it('contains produktleder, tech_lead, and utvikler', () => {
    expect([...TEAM_ROLES]).toEqual(['produktleder', 'tech_lead', 'utvikler'])
  })
})
