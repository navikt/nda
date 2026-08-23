// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { composeStory, setProjectAnnotations } from '@storybook/react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import meta, { EmptyState, KeyboardShortcut, LoadingState, SearchResults } from './SearchDialog.stories'

setProjectAnnotations(preview)

afterEach(cleanup)

const SearchResultsStory = composeStory(SearchResults, meta)
const EmptyStateStory = composeStory(EmptyState, meta)
const LoadingStateStory = composeStory(LoadingState, meta)
const KeyboardShortcutStory = composeStory(KeyboardShortcut, meta)

describe('SearchDialog story interaction characterization', () => {
  it('shows real search results after typing a query', async () => {
    const { container } = render(<SearchResultsStory />)
    await SearchResultsStory.play?.({ canvasElement: container })

    expect(screen.getByText('Deployment #123')).toBeInTheDocument()
    expect(screen.getByText('Ola Nordmann')).toBeInTheDocument()
  })

  it('shows the empty-results message when the search yields no hits', async () => {
    const { container } = render(<EmptyStateStory />)
    await EmptyStateStory.play?.({ canvasElement: container })

    expect(screen.getByText('Ingen resultater for "xyz123"')).toBeInTheDocument()
  })

  it('shows the loading indicator while the search request is pending', async () => {
    const { container } = render(<LoadingStateStory />)
    await LoadingStateStory.play?.({ canvasElement: container })

    expect(screen.getByTitle('Venter…')).toBeInTheDocument()
  })

  it('renders the keyboard shortcut hint on the trigger', async () => {
    const { container } = render(<KeyboardShortcutStory />)
    await KeyboardShortcutStory.play?.({ canvasElement: container })

    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })
})
