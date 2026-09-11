import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockCanAccessRepositoryAdmin,
  mockUpdateRepositorySettingsByRepositoryId,
  mockIsCurrentOrHistoricalNameForRepositoryId,
  mockGetRepositoryById,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCanAccessRepositoryAdmin: vi.fn(),
  mockUpdateRepositorySettingsByRepositoryId: vi.fn(),
  mockIsCurrentOrHistoricalNameForRepositoryId: vi.fn(),
  mockGetRepositoryById: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/authorization.server', () => ({
  canAccessRepositoryAdmin: mockCanAccessRepositoryAdmin,
}))

vi.mock('~/db/repositories.server', () => ({
  updateRepositorySettingsByRepositoryId: mockUpdateRepositorySettingsByRepositoryId,
  isCurrentOrHistoricalNameForRepositoryId: mockIsCurrentOrHistoricalNameForRepositoryId,
  getRepositoryById: mockGetRepositoryById,
}))

vi.mock('~/lib/route-params.server', () => ({
  requireParams: (params: Record<string, string | undefined>, keys: string[]) => {
    const result: Record<string, string> = {}
    for (const key of keys) {
      const value = params[key]
      if (!value) throw new Response(`Missing param ${key}`, { status: 400 })
      result[key] = value
    }
    return result
  },
}))

vi.mock('~/lib/form-validators', () => ({
  getFormString: (formData: FormData, key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  },
}))

vi.mock('~/lib/verification/types', () => ({
  isImplicitApprovalMode: (value: string) => value === 'off' || value === 'dependabot_only' || value === 'all',
}))

import { action } from './repository.$owner.$repo.admin.actions.server'

const REPO_PARAMS = { owner: 'navikt', repo: 'some-repo' }

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/repository/navikt/some-repo/admin', {
    method: 'POST',
    body: formData,
  })
}

function callAction(formData: FormData) {
  return action({ request: makeRequest(formData), params: REPO_PARAMS } as never)
}

describe('repository admin actions - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockCanAccessRepositoryAdmin.mockResolvedValue(true)
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
  })

  it('resolves the repository from the submitted repository_id and authorizes with its id', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['default_branch'],
    })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    await callAction(formData)

    expect(mockGetRepositoryById).toHaveBeenCalledWith(5)
    expect(mockIsCurrentOrHistoricalNameForRepositoryId).toHaveBeenCalledWith(5, 'navikt', 'some-repo')
    expect(mockCanAccessRepositoryAdmin).toHaveBeenCalledWith(expect.anything(), 5)
  })

  it('rejects when the submitted repository_id does not resolve to the repository in the URL', async () => {
    mockGetRepositoryById.mockResolvedValue({ id: 999, github_owner: 'navikt', github_repo_name: 'other-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '999')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Repository-ID samsvarer ikke med repositoryet i URL-en' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('rejects when the submitted repository_id does not exist', async () => {
    mockGetRepositoryById.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Fant ikke repositoryet' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
  })

  it('accepts the URL when it uses a historical (renamed) owner/repo for the submitted repository_id', async () => {
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'renamed-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['default_branch'],
    })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(mockCanAccessRepositoryAdmin).toHaveBeenCalledWith(expect.anything(), 5)
    expect(result).toEqual({ success: expect.stringContaining('Default branch oppdatert') })
  })

  it('rejects when the URL owner/repo cannot be resolved to the submitted repository at all', async () => {
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'renamed-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Repository-ID samsvarer ikke med repositoryet i URL-en' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
  })

  it('rejects when the actor lacks admin access to the repository', async () => {
    mockCanAccessRepositoryAdmin.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('rejects when repository_id is missing or non-numeric', async () => {
    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig eller manglende repository-ID' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
  })

  it('rejects a spoofed non-numeric repository_id even when action data looks valid', async () => {
    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', 'not-a-number')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig eller manglende repository-ID' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('rejects a partially-numeric repository_id such as "5abc" or "5.9"', async () => {
    for (const value of ['5abc', '5.9']) {
      const formData = new FormData()
      formData.set('action', 'update_default_branch')
      formData.set('repository_id', value)
      formData.set('default_branch', 'main')

      const result = await callAction(formData)

      expect(result).toEqual({ error: 'Ugyldig eller manglende repository-ID' })
    }
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('successfully updates the default branch', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['default_branch'],
    })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(mockUpdateRepositorySettingsByRepositoryId).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 5, patch: { defaultBranch: 'main' } }),
    )
    expect(result).toEqual({ success: expect.stringContaining('Default branch oppdatert') })
  })

  it('rejects a default_branch value longer than 255 characters', async () => {
    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'x'.repeat(256))

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Default branch kan ikke være lengre enn 255 tegn' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('successfully updates the implicit approval mode', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['implicit_approval'],
    })

    const formData = new FormData()
    formData.set('action', 'update_implicit_approval')
    formData.set('repository_id', '5')
    formData.set('mode', 'all')

    const result = await callAction(formData)

    expect(mockUpdateRepositorySettingsByRepositoryId).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 5, patch: { implicitApprovalMode: 'all' } }),
    )
    expect(result).toEqual({ success: expect.stringContaining('Implisitt godkjenning') })
  })

  it('successfully updates the audit start year', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['audit_start_year'],
    })

    const formData = new FormData()
    formData.set('action', 'update_audit_start_year')
    formData.set('repository_id', '5')
    formData.set('audit_start_year', '2022')

    const result = await callAction(formData)

    expect(mockUpdateRepositorySettingsByRepositoryId).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 5, patch: { auditStartYear: 2022 } }),
    )
    expect(result).toEqual({ success: expect.stringContaining('oppdatert') })
  })

  it('maps repo_not_found to a not-found message', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({ ok: false, reason: 'repo_not_found' })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Fant ikke repositoryet' })
  })

  it('maps repo_not_linked to a distinct message', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({ ok: false, reason: 'repo_not_linked' })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Repositoryet er ikke lenger koblet til noen aktiv app' })
  })

  it('rejects update_implicit_approval with an invalid mode', async () => {
    const formData = new FormData()
    formData.set('action', 'update_implicit_approval')
    formData.set('repository_id', '5')
    formData.set('mode', 'not-a-real-mode')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig modus' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('rejects update_audit_start_year with an out-of-range year', async () => {
    const formData = new FormData()
    formData.set('action', 'update_audit_start_year')
    formData.set('repository_id', '5')
    formData.set('audit_start_year', '1800')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig startår. Må være mellom 2000 og 2100.' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('returns an error for an unknown action', async () => {
    const formData = new FormData()
    formData.set('action', 'not_a_real_action')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ukjent handling' })
  })
})
