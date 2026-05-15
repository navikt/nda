import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './DevTeamCoverage.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const {
  FullCoverage,
  NoMappedGitHub,
  NoMappedGitHubWithBoardDeployments,
  NoMembers,
  PartialCoverage,
  WithNonMemberDeployments,
} = composeStories(stories)

describe('DevTeamCoverage stories baseline characterization', () => {
  it('FullCoverage keeps complete metrics with no warning alerts', () => {
    const html = renderToStaticMarkup(<FullCoverage />)

    expect(html).toContain('aria-label="Leveranser i år: 142"')
    expect(html).toContain('aria-label="4-øyne-dekning: 100%"')
    expect(html).toContain('aria-label="Endringsopphav: 100%"')
    expect(html).toContain('aria-label="Fra andre: 0"')
    expect(html).toContain('142 av 142')
    expect(html).not.toContain('mangler GitHub-brukernavn')
  })

  it('WithNonMemberDeployments keeps baseline counts for board-linked external deploys', () => {
    const html = renderToStaticMarkup(<WithNonMemberDeployments />)

    expect(html).toContain('aria-label="Leveranser i år: 89"')
    expect(html).toContain('aria-label="4-øyne-dekning: 92%"')
    expect(html).toContain('82 av 89')
    expect(html).toContain('aria-label="Endringsopphav: 82%"')
    expect(html).toContain('73 av 89')
    expect(html).toContain('aria-label="Fra andre: 12"')
    expect(html).toContain('Koblet via måltavle')
  })

  it('PartialCoverage keeps warning when some members are unmapped', () => {
    const html = renderToStaticMarkup(<PartialCoverage />)

    expect(html).toContain('1 av 3 medlemmer mangler GitHub-brukernavn')
    expect(html).toContain('statistikken kan være ufullstendig')
    expect(html).toContain('aria-label="Leveranser i år: 56"')
    expect(html).toContain('aria-label="4-øyne-dekning: 76%"')
    expect(html).toContain('43 av 56')
    expect(html).toContain('aria-label="Endringsopphav: 55%"')
    expect(html).toContain('aria-label="Fra andre: 5"')
  })

  it('NoMembers keeps info alert and hides metric cards', () => {
    const html = renderToStaticMarkup(<NoMembers />)

    expect(html).toContain('Ingen medlemmer er registrert for dette teamet enda.')
    expect(html).toContain('Statistikk på team-medlemmenes deploys vises når medlemmer er lagt til.')
    expect(html).not.toContain('Leveranser i år')
  })

  it('NoMappedGitHub keeps warning when team has members but no mappings', () => {
    const html = renderToStaticMarkup(<NoMappedGitHub />)

    expect(html).toContain('Ingen av de 3 medlemmene har et GitHub-brukernavn registrert.')
    expect(html).toContain('Statistikk vises når brukerkoblinger er på plass.')
    expect(html).toContain('aria-label="Leveranser i år: 0"')
    expect(html).toContain('aria-label="4-øyne-dekning: 0%"')
    expect(html).toContain('aria-label="Endringsopphav: 0%"')
    expect(html).toContain('aria-label="Fra andre: 0"')
  })

  it('NoMappedGitHubWithBoardDeployments keeps board-only warning and baseline cards', () => {
    const html = renderToStaticMarkup(<NoMappedGitHubWithBoardDeployments />)

    expect(html).toContain(
      'Ingen av de 3 medlemmene har et GitHub-brukernavn registrert — kun leveranser koblet til måltavlen vises.',
    )
    expect(html).toContain('aria-label="Leveranser i år: 15"')
    expect(html).toContain('aria-label="4-øyne-dekning: 80%"')
    expect(html).toContain('12 av 15')
    expect(html).toContain('aria-label="Endringsopphav: 100%"')
    expect(html).toContain('aria-label="Fra andre: 15"')
    expect(html).toContain('15 av 15')
  })
})
