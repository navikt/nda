import { composeStories, setProjectAnnotations } from '@storybook/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import * as stories from './SearchDialog.stories'

setProjectAnnotations(preview)

const { SearchResults, EmptyState, LoadingState, KeyboardShortcut } = composeStories(stories)

describe('SearchDialog story baseline characterization', () => {
  it('renders the real SearchDialog trigger for the search-results scenario', () => {
    const html = renderToStaticMarkup(<SearchResults />)

    expect(html).toContain('Søk...')
    expect(html).toContain('⌘K')
  })

  it('renders the real SearchDialog trigger for the empty-state scenario', () => {
    const html = renderToStaticMarkup(<EmptyState />)

    expect(html).toContain('Søk...')
  })

  it('renders the real SearchDialog trigger for the loading scenario', () => {
    const html = renderToStaticMarkup(<LoadingState />)

    expect(html).toContain('Søk...')
  })

  it('renders the real SearchDialog trigger with keyboard shortcut hint', () => {
    const html = renderToStaticMarkup(<KeyboardShortcut />)

    expect(html).toContain('⌘K')
  })
})
