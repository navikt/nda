import { composeStories, setProjectAnnotations } from '@storybook/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import * as stories from './Search.stories'

setProjectAnnotations(preview)

const { Empty, ManyResults, NoResults, SingleTeamResult, WithResults } = composeStories(stories)

describe('Search story baseline characterization', () => {
  it('renders empty search state and search input', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain('Søk')
    expect(html).toContain('Bruk søkefeltet i header for å søke')
    expect(html).toContain('name="q"')
    expect(html).toContain('search-result-item:hover')
  })

  it('renders result entries and type tags for result scenario', () => {
    const html = renderToStaticMarkup(<WithResults />)

    expect(html).toContain('resultater for &quot;john&quot;')
    expect(html).toContain('Deployment')
    expect(html).toContain('Bruker')
    expect(html).toContain('search-result-item')
  })

  it('renders a single Nais team result with the singular application count', () => {
    const html = renderToStaticMarkup(<SingleTeamResult />)

    expect(html).toContain('pensjon-regler')
    expect(html).toContain('Nais-team')
    expect(html).toContain('1 applikasjon')
  })

  it('renders no-results message for no-hit scenario', () => {
    const html = renderToStaticMarkup(<NoResults />)

    expect(html).toContain('Ingen resultater for &quot;xyz123&quot;')
  })

  it('renders extended set of results in many-results scenario', () => {
    const html = renderToStaticMarkup(<ManyResults />)

    expect(html).toContain('def456ghi789')
    expect(html).toContain('navikt/pensjon-monorepo')
    expect(html).toContain('Pensjon kjerneteam')
    expect(html).toContain('pensjondeployer')
    expect(html).toContain('pensjon-opptjening')
    expect(html).toContain('/users/jane-doe')
    expect(html).toContain('Monorepo')
    expect(html).toContain('Utviklerteam')
    expect(html).toContain('Nais-team')
    expect(html).toContain('App')
  })
})
