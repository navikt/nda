import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './DeploymentDetail.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const { Approved, DirectPush, ManuallyApproved, NotApproved, Pending } = composeStories(stories)

describe('DeploymentDetail story baseline characterization', () => {
  it('Approved story keeps deployment summary and PR details', () => {
    const html = renderToStaticMarkup(<Approved />)

    expect(html).toContain('Deployment #123')
    expect(html).toContain('Godkjent')
    expect(html).toContain('john-doe')
    expect(html).toContain('navikt/pensjon-pen')
    expect(html).toContain('#42')
    expect(html).toContain('feat: Add new feature for pension calculation')
    expect(html).toContain('jane-smith')
    expect(html).toContain('bob-wilson')
  })

  it('NotApproved story keeps admin action panel visible', () => {
    const html = renderToStaticMarkup(<NotApproved />)

    expect(html).toContain('Uverifiserte commits')
    expect(html).toContain('Admin-handlinger')
    expect(html).toContain('Re-verifiser')
    expect(html).toContain('Godkjenn manuelt')
  })

  it('Pending story keeps pending label and admin actions', () => {
    const html = renderToStaticMarkup(<Pending />)

    expect(html).toContain('Venter')
    expect(html).toContain('Admin-handlinger')
    expect(html).toContain('Re-verifiser')
  })

  it('DirectPush story keeps no-PR baseline behavior', () => {
    const html = renderToStaticMarkup(<DirectPush />)

    expect(html).toContain('Direkte push')
    expect(html).toContain('hotfix: Emergency fix for production bug')
    expect(html).not.toContain('Pull Request')
    expect(html).not.toContain('Opprettet av')
    expect(html).not.toContain('#42')
  })

  it('ManuallyApproved story keeps admin actions hidden', () => {
    const html = renderToStaticMarkup(<ManuallyApproved />)

    expect(html).toContain('Manuelt godkjent')
    expect(html).not.toContain('Admin-handlinger')
    expect(html).not.toContain('Godkjenn manuelt')
  })
})
