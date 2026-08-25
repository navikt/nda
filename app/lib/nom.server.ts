import { fetchWithLogging, logger } from '~/lib/logger.server'
import type { UserLookupResult } from '~/lib/user-lookup-types'

interface NomToken {
  access_token: string
  expires_in: number
}

interface NomRessurs {
  navident: string
  epost: string | null
  visningsnavn: string | null
}

interface NomSearchRessurs {
  navident: string
  visningsnavn: string | null
}

interface NomRessurserResponse {
  data?: { ressurser: { ressurs: NomRessurs | null }[] }
  errors?: { message: string }[]
}

interface NomSearchRessursResponse {
  data?: { searchRessurs: NomSearchRessurs[] }
  errors?: { message: string }[]
}

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token
  }

  const tokenEndpoint = process.env.NAIS_TOKEN_ENDPOINT
  if (!tokenEndpoint) {
    throw new Error('NAIS_TOKEN_ENDPOINT is not configured')
  }

  const target = process.env.NOM_API_SCOPE
  if (!target) {
    throw new Error('NOM_API_SCOPE is not configured')
  }

  const response = await fetchWithLogging('nom', tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity_provider: 'entra_id',
      target,
    }),
  })

  if (!response.ok) {
    logger.error('Failed to acquire NOM token', { status: response.status })
    throw new Error(`Token acquisition failed: ${response.status}`)
  }

  const data: NomToken = await response.json()

  const bufferSeconds = Math.max(0, Math.min(300, data.expires_in - 60))
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - bufferSeconds) * 1000,
  }

  return data.access_token
}

function getApiUrl(): string {
  const url = process.env.NOM_API_URL
  if (!url) {
    throw new Error('NOM_API_URL is not configured')
  }
  return url
}

function toUserResult(ressurs: NomRessurs): UserLookupResult {
  return {
    displayName: ressurs.visningsnavn,
    navIdent: ressurs.navident,
    email: ressurs.epost,
  }
}

function toSearchUserResult(ressurs: NomSearchRessurs): UserLookupResult {
  return {
    displayName: ressurs.visningsnavn,
    navIdent: ressurs.navident,
    email: null,
  }
}

function assertNoFatalErrors<T>(result: { data?: T; errors?: { message: string }[] }, hasData: (data: T) => boolean) {
  if (!result.errors?.length) return

  if (result.data && hasData(result.data)) {
    logger.warn('NOM API returned partial errors, using available data', { errorCount: result.errors.length })
    return
  }

  logger.error('NOM API returned errors', { errors: result.errors })
  throw new Error(`NOM API returned errors: ${result.errors.map((e) => e.message).join(', ')}`)
}

async function queryNom<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const [token, url] = [await getAccessToken(), getApiUrl()]

  const response = await fetchWithLogging('nom', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    logger.error('NOM API request failed', { status: response.status })
    throw new Error(`NOM API request failed: ${response.status}`)
  }

  return response.json()
}

const RESSURSER_BY_NAV_IDENT_QUERY = `
  query HentRessurser($navIdenter: [String!]) {
    ressurser(where: { navidenter: $navIdenter }) {
      ressurs {
        navident
        epost
        visningsnavn
      }
    }
  }
`

const SEARCH_RESSURS_QUERY = `
  query SearchRessurs($term: String!) {
    searchRessurs(term: $term) {
      navident
      visningsnavn
    }
  }
`

export async function getNomUsersByNavIdenter(navIdenter: string[]): Promise<UserLookupResult[]> {
  if (navIdenter.length === 0) return []

  const result = await queryNom<NomRessurserResponse>(RESSURSER_BY_NAV_IDENT_QUERY, { navIdenter })

  assertNoFatalErrors(result, (data) => data.ressurser.some((r) => r.ressurs !== null))

  return (result.data?.ressurser ?? []).flatMap((r) => (r.ressurs ? [toUserResult(r.ressurs)] : []))
}

export async function searchNomUsers(query: string): Promise<UserLookupResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const isNavIdent = /^[A-Za-z]\d{6}$/.test(trimmed)

  if (isNavIdent) {
    return getNomUsersByNavIdenter([trimmed.toUpperCase()])
  }

  const result = await queryNom<NomSearchRessursResponse>(SEARCH_RESSURS_QUERY, { term: trimmed })

  assertNoFatalErrors(result, (data) => data.searchRessurs.length > 0)

  return (result.data?.searchRessurs ?? []).map(toSearchUserResult)
}
