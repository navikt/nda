import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './Admin.stories'

vi.mock('react-router', async () => {
  const React = await import('react')

  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const { Default, WithPendingVerifications } = composeStories(stories)

describe('Admin story baseline characterization', () => {
  it('renders admin entry points when there are no pending verifications', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Administrasjon')
    expect(html).toContain('/deployments/verify')
    expect(html).toContain('/admin/audit-reports')
    expect(html).toContain('/admin/users')
    expect(html).toContain('/admin/sync-jobs')
    expect(html).toContain('/admin/slack')
    expect(html).toContain('Verifiser deployments mot GitHub.')
    expect(html).not.toContain('deployments venter på verifisering.')
  })

  it('renders pending verification messaging when pending deployments exist', () => {
    const html = renderToStaticMarkup(<WithPendingVerifications />)

    expect(html).toContain('5 deployments venter på verifisering.')
    expect(html).toContain('GitHub-verifisering')
  })
})
