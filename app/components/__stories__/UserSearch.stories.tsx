import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { UserSearch } from '~/components/UserSearch'

function mockFetchUserSearch(response: { status: number; body: unknown }) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/users/search')) {
      return new Response(JSON.stringify(response.body), { status: response.status })
    }
    return originalFetch(input, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

function mockFetchUserSearchRejecting() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/users/search')) {
      throw new Error('network down')
    }
    return originalFetch(input, init)
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
    try {
      const canvas = within(canvasElement)

      await userEvent.type(canvas.getByRole('combobox'), 'Glad Fjord')

      await waitFor(() =>
        expect(within(document.body).getByRole('option', { name: 'Glad Fjord (Z990001)' })).toBeInTheDocument(),
      )
    } finally {
      restoreFetch()
    }
  },
}

export const ErrorFromApi: Story = {
  name: 'Feil fra API',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchUserSearch({
      status: 502,
      body: { results: [], error: 'Brukeroppslag er utilgjengelig' },
    })
    try {
      const canvas = within(canvasElement)

      await userEvent.type(canvas.getByRole('combobox'), 'Glad Fjord')

      await waitFor(() => expect(canvas.getByText('Brukeroppslag er utilgjengelig')).toBeInTheDocument())
    } finally {
      restoreFetch()
    }
  },
}

export const NetworkError: Story = {
  name: 'Nettverksfeil',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchUserSearchRejecting()
    try {
      const canvas = within(canvasElement)

      await userEvent.type(canvas.getByRole('combobox'), 'Glad Fjord')

      await waitFor(() => expect(canvas.getByText('Søket feilet')).toBeInTheDocument())
    } finally {
      restoreFetch()
    }
  },
}
