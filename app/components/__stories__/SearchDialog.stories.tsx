import type { Meta, StoryObj } from '@storybook/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { SearchDialog } from '~/components/SearchDialog'
import type { SearchResult } from '~/db/deployments/search.server'

const mockResults: SearchResult[] = [
  {
    type: 'deployment',
    id: 123,
    url: '/team/pensjonopptjening/env/prod-fss/app/pensjon-pen/deployments/123',
    title: 'Deployment #123',
    subtitle: 'pensjon-pen • abc1234',
  },
  {
    type: 'deployment',
    id: 122,
    url: '/team/pensjonopptjening/env/prod-fss/app/pensjon-pen/deployments/122',
    title: 'Deployment #122',
    subtitle: 'pensjon-pen • def5678',
  },
  {
    type: 'dev_team',
    url: '/dev-teams/pensjon-opptjening',
    title: 'Pensjon Opptjening',
    subtitle: 'Utviklerteam · 14 apper',
  },
  {
    type: 'team',
    url: '/team/pensjonopptjening',
    title: 'pensjonopptjening',
    subtitle: '14 applikasjoner',
  },
  {
    type: 'app',
    url: '/team/pensjonopptjening/env/prod-fss/app/pensjon-pen',
    title: 'pensjon-pen',
    subtitle: 'pensjonopptjening',
  },
  {
    type: 'user',
    url: '/user/ola-nordmann',
    title: 'Ola Nordmann',
    subtitle: 'olanord • 42 deployment(s)',
  },
]

function mockFetchSearch(results: SearchResult[], delayMs = 0) {
  const originalFetch = global.fetch
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/search')) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return new Response(JSON.stringify({ results }), { status: 200 })
    }
    return originalFetch(input)
  }) as typeof fetch
  return () => {
    global.fetch = originalFetch
  }
}

const meta: Meta<typeof SearchDialog> = {
  title: 'Components/SearchDialog',
  component: SearchDialog,
  parameters: {
    router: { skip: true },
  },
  decorators: [
    (Story) => {
      const router = createMemoryRouter([{ path: '*', element: <Story /> }], { initialEntries: ['/'] })
      return <RouterProvider router={router} />
    },
  ],
}

export default meta

type Story = StoryObj<typeof meta>

export const SearchResults: Story = {
  name: 'Søkeresultater',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchSearch(mockResults)
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByText('Søk...'))
    const searchInput = await within(document.body).findByLabelText('Søk')
    await userEvent.type(searchInput, 'pensjon')

    await waitFor(() => expect(within(document.body).getByText('Deployment #123')).toBeInTheDocument())

    restoreFetch()
  },
}

export const EmptyState: Story = {
  name: 'Ingen resultater',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchSearch([])
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByText('Søk...'))
    const searchInput = await within(document.body).findByLabelText('Søk')
    await userEvent.type(searchInput, 'xyz123')

    await waitFor(() => expect(within(document.body).getByText('Ingen resultater for "xyz123"')).toBeInTheDocument())

    restoreFetch()
  },
}

export const LoadingState: Story = {
  name: 'Laster',
  play: async ({ canvasElement }) => {
    const restoreFetch = mockFetchSearch(mockResults, 5000)
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByText('Søk...'))
    const searchInput = await within(document.body).findByLabelText('Søk')
    await userEvent.type(searchInput, 'pensjon')

    restoreFetch()
  },
}

export const KeyboardShortcut: Story = {
  name: 'Tastatursnarvei',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('⌘K')).toBeInTheDocument()
  },
}
