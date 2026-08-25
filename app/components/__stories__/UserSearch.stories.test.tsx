// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { composeStory, setProjectAnnotations } from '@storybook/react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import meta, { ErrorFromApi, NetworkError, SearchResults } from './UserSearch.stories'

setProjectAnnotations(preview)

afterEach(cleanup)

const SearchResultsStory = composeStory(SearchResults, meta)
const ErrorFromApiStory = composeStory(ErrorFromApi, meta)
const NetworkErrorStory = composeStory(NetworkError, meta)

describe('UserSearch story interaction characterization', () => {
  it('shows matching users after typing a query', async () => {
    const { container } = render(<SearchResultsStory />)
    await SearchResultsStory.play?.({ canvasElement: container })

    expect(screen.getByRole('option', { name: 'Glad Fjord (Z990001)' })).toBeInTheDocument()
  })

  it('shows the API error message when the search request fails', async () => {
    const { container } = render(<ErrorFromApiStory />)
    await ErrorFromApiStory.play?.({ canvasElement: container })

    expect(screen.getByText('Brukeroppslag er utilgjengelig')).toBeInTheDocument()
  })

  it('closes the options dropdown so the error message is not hidden behind it', async () => {
    const { container } = render(<ErrorFromApiStory />)
    await ErrorFromApiStory.play?.({ canvasElement: container })

    expect(container.querySelector('.aksel-combobox__list')).toHaveClass('aksel-combobox__list--closed')
  })

  it('shows a generic error message when the search request throws', async () => {
    const { container } = render(<NetworkErrorStory />)
    await NetworkErrorStory.play?.({ canvasElement: container })

    expect(screen.getByText('Søket feilet')).toBeInTheDocument()
  })
})
