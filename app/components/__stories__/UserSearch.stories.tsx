import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { UserSearch } from '~/components/UserSearch'

function mockFetchUserSearch(response: { status: number; body: unknown }) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/users/search')) {
      return new Response(JSON.stringify(response.body), { status: response.status })
    }
    return originalFetch(input)
  }) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

function mockFetchUserSearchRejecting() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

const meta: Meta<typeof UserSearch> = {
  title: 'Components/UserSearch',
  component: UserSearch,
  args: {
    onSelect: () => {},
  },
}

export default meta

type Story = StoryObj<typeof meta>

export const SearchResults: Story = {
  name: 'Søkeresultater',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchUserSearch({
      status: 200,
      body: { results: [{ displayName: 'Glad Fjord', navIdent: 'Z990001', email: 'glad.fjord@nav.no' }] },
    })
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('combobox'), 'Glad Fjord')

    await waitFor(() =>
      expect(within(document.body).getByRole('option', { name: 'Glad Fjord (Z990001)' })).toBeInTheDocument(),
    )

    restoreFetch()
  },
}

export const ErrorFromApi: Story = {
  name: 'Feil fra API',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchUserSearch({
      status: 502,
      body: { results: [], error: 'Brukeroppslag er utilgjengelig' },
    })
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('combobox'), 'Glad Fjord')

    await waitFor(() => expect(canvas.getByText('Brukeroppslag er utilgjengelig')).toBeInTheDocument())

    restoreFetch()
  },
}

export const NetworkError: Story = {
  name: 'Nettverksfeil',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchUserSearchRejecting()
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('combobox'), 'Glad Fjord')

    await waitFor(() => expect(canvas.getByText('Søket feilet')).toBeInTheDocument())

    restoreFetch()
  },
}
