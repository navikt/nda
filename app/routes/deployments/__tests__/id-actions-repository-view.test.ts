import { expect, it } from 'vitest'
import { action } from '../$id.actions.server'

it('rejects repository-view POSTs before reading any mutation input', async () => {
  const url = new URL('http://localhost/deployments/42?view=repository')
  const request = new Request(url, { method: 'POST', body: new URLSearchParams({ intent: 'manual_approval' }) })
  expect(await action({ url, request, params: { id: '42' } })).toEqual({
    error: 'Repositoryvisningen er skrivebeskyttet. Bruk den felles repositorygodkjenningen.',
  })
  expect(request.bodyUsed).toBe(false)
})
