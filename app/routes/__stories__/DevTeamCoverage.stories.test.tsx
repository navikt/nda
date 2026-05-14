import type { ReactNode } from 'react'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './DevTeamCoverage.stories'
import {
  FullCoverage,
  NoMappedGitHub,
  NoMappedGitHubWithBoardDeployments,
  NoMembers,
  PartialCoverage,
  WithNonMemberDeployments,
} from './DevTeamCoverage.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

function renderStory(args: Record<string, unknown> = {}) {
  const meta = stories.default as { component: (props: Record<string, unknown>) => React.ReactElement }
  return renderToStaticMarkup(React.createElement(meta.component, args))
}

describe('DevTeamCoverage stories baseline characterization', () => {
  it('FullCoverage keeps complete metrics with no warning alerts', () => {
    const html = renderStory(FullCoverage.args)

    expect(html).toContain('Leveranser i år')
    expect(html).toContain('4-øyne-dekning')
    expect(html).toContain('100%')
    expect(html).toContain('142 av 142')
    expect(html).not.toContain('mangler GitHub-brukernavn')
  })

  it('WithNonMemberDeployments keeps baseline counts for board-linked external deploys', () => {
    const html = renderStory(WithNonMemberDeployments.args)

    expect(html).toContain('89')
    expect(html).toContain('92%')
    expect(html).toContain('Fra andre')
    expect(html).toContain('12')
    expect(html).toContain('Koblet via måltavle')
  })

  it('PartialCoverage keeps warning when some members are unmapped', () => {
    const html = renderStory(PartialCoverage.args)

    expect(html).toContain('1 av 3 medlemmer mangler GitHub-brukernavn')
    expect(html).toContain('statistikken kan være ufullstendig')
    expect(html).toContain('76%')
  })

  it('NoMembers keeps info alert and hides metric cards', () => {
    const html = renderStory(NoMembers.args)

    expect(html).toContain('Ingen medlemmer er registrert for dette teamet enda.')
    expect(html).toContain('Statistikk på team-medlemmenes deploys vises når medlemmer er lagt til.')
    expect(html).not.toContain('Leveranser i år')
  })

  it('NoMappedGitHub keeps warning when team has members but no mappings', () => {
    const html = renderStory(NoMappedGitHub.args)

    expect(html).toContain('Ingen av de 3 medlemmene har et GitHub-brukernavn registrert.')
    expect(html).toContain('Statistikk vises når brukerkoblinger er på plass.')
    expect(html).toContain('Leveranser i år')
  })

  it('NoMappedGitHubWithBoardDeployments keeps board-only warning and baseline cards', () => {
    const html = renderStory(NoMappedGitHubWithBoardDeployments.args)

    expect(html).toContain(
      'Ingen av de 3 medlemmene har et GitHub-brukernavn registrert — kun leveranser koblet til måltavlen vises.',
    )
    expect(html).toContain('15')
    expect(html).toContain('80%')
    expect(html).toContain('100%')
  })
})
