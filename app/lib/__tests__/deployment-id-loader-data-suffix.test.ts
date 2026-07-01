import { describe, expect, it, vi } from 'vitest'

vi.mock('~/db/deployments.server', () => ({
  getDeploymentById: vi.fn().mockResolvedValue({ id: 42, monitored_app_id: 7, created_at: new Date('2024-01-01') }),
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationById: vi
    .fn()
    .mockResolvedValue({ team_slug: 'plattform', environment_name: 'prod', app_name: 'nda' }),
}))

import { loader } from '../../routes/deployments/$id.loader.server'

describe('deployments/$id loader legacy redirect (React Router v8 .data suffix)', () => {
  it('redirects to the canonical team/env/app URL without leaking the .data suffix from request.url', async () => {
    const response = await loader({
      params: { id: '42' },
      request: new Request('http://localhost/deployments/42.data'),
      url: new URL('http://localhost/deployments/42'),
    } as never)

    expect(response).toBeInstanceOf(Response)
    const location = (response as Response).headers.get('Location')
    expect(location).toBe('http://localhost/team/plattform/env/prod/app/nda/deployments/42')
    expect(location).not.toContain('.data')
  })

  it('still matches the legacy pathname check when request.url carries the .data suffix', async () => {
    const response = await loader({
      params: { id: '42' },
      request: new Request('http://localhost/deployments/42.data?status=approved'),
      url: new URL('http://localhost/deployments/42?status=approved'),
    } as never)

    expect(response).toBeInstanceOf(Response)
    const location = (response as Response).headers.get('Location')
    expect(location).toBe('http://localhost/team/plattform/env/prod/app/nda/deployments/42?status=approved')
  })
})
