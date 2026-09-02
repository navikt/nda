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

const { Default } = composeStories(stories)

describe('Admin story baseline characterization', () => {
  it('renders all admin entry points', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Administrasjon')
    expect(html).toContain('/deployments/verify')
    expect(html).toContain('/admin/audit-reports')
    expect(html).toContain('/admin/users')
    expect(html).toContain('/admin/sync-jobs')
    expect(html).toContain('/admin/global-settings')
    expect(html).toContain('/admin/env')
    expect(html).toContain('/admin/application-groups')
    expect(html).toContain('/admin/workflow-triggers')
    expect(html).toContain('/admin/workflow-patterns')
    expect(html).toContain('/admin/verification-diffs')
    expect(html).toContain('/admin/data-mismatches')
    expect(html).toContain('/admin/soft-deleted')
    expect(html).toContain('/sections')
    expect(html).toContain('/admin/section-roles')
    expect(html).toContain('/admin/validate-monitored-apps')
    expect(html).toContain('Verifiser deployments mot GitHub.')
    expect(html).toContain('Sjekk verifiseringsavvik på tvers av alle applikasjoner.')
    expect(html).toContain('Tittel-avvik, baseline uten godkjenner og andre datakvalitetsproblemer.')
    expect(html).toContain('Se og gjenopprett logisk slettede rader.')
  })
})
