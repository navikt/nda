import { describe, expect, it } from 'vitest'
import { homeTabFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildHomeTabBlocks } from '~/lib/slack/blocks'

describe('buildHomeTabBlocks (personalized)', () => {
  it('produces blocks for a fully populated user (boards + team + person issues)', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.withIssues)
    expect(blocks.length).toBeGreaterThan(0)
    const text = JSON.stringify(blocks)
    expect(text).not.toContain('Deployment Audit')
    expect(text).toContain('Skjermbildemodernisering')
    expect(text).toContain('godkjenning')
    expect(text).toContain('endringsopphav')
  })

  it('shows team-scoped issue breakdown including missing goal links', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.withIssues)
    const text = JSON.stringify(blocks)
    expect(text).toContain('3 applikasjoner som trenger oppfølging')
    expect(text).toContain('15 deployments uten godkjenning')
    expect(text).toContain('3 deployments venter verifisering')
    expect(text).toContain('8 deployments uten endringsopphav')
  })

  it('shows "ingen mangler" when there are no issues', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.noIssues)
    const text = JSON.stringify(blocks)
    expect(text).toMatch(/Ingen åpne|Alle dine deployments/)
  })

  it('renders an onboarding hint (not the empty-state) when github_username is missing', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.noGithubUser)
    const text = JSON.stringify(blocks)
    expect(text).toContain('Endringsopphav')
    expect(text).toContain('GitHub-brukernavnet')
    expect(text).toContain('open_profile')
    expect(text).not.toContain('Alle dine deployments har endringsopphav')
  })

  it('shows onboarding when user has no mapping', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.noMapping)
    const text = JSON.stringify(blocks)
    expect(text.toLowerCase()).toMatch(/koble|mapping|nda/)
  })

  it('handles users without active boards', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.noBoards)
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('respects Slack 100-block limit', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.withIssues)
    expect(blocks.length).toBeLessThanOrEqual(100)
  })

  it('shows inline keywords without modal buttons', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.withIssues)
    const text = JSON.stringify(blocks)
    expect(text).toContain('Kodeord:')
    expect(text).not.toContain('show_kr_keywords')
  })

  it('shows unmapped contributors warning when present', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.withIssues)
    const text = JSON.stringify(blocks)
    expect(text).toContain('deployere mangler brukermapping')
    expect(text).toContain('external-contractor')
    expect(text).toContain('summer-intern')
    expect(text).toContain('open_user_mapping_unmapped')
  })

  it('does not show unmapped contributors warning when list is empty', () => {
    const blocks = buildHomeTabBlocks(homeTabFixtures.noIssues)
    const text = JSON.stringify(blocks)
    expect(text).not.toContain('deployere mangler')
  })
})
