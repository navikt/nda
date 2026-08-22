import { fetchWithLogging, logger } from '~/lib/logger.server'
import type { NomUserResult } from '~/lib/nom-types'
import { formatDisplayNameNatural } from '~/lib/user-display'

interface NomToken {
  access_token: string
  expires_in: number
}

interface NomRessurs {
  navident: string
  epost: string | null
  visningsnavn: string | null
}

interface NomRessurserResponse {
  data?: { ressurser: { ressurs: NomRessurs | null }[] }
  errors?: { message: string }[]
}

interface NomSearchRessursResponse {
  data?: { searchRessurs: NomRessurs[] }
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

function toUserResult(ressurs: NomRessurs): NomUserResult {
  return {
    displayName: ressurs.visningsnavn,
    navIdent: ressurs.navident,
    email: ressurs.epost,
  }
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
      epost
      visningsnavn
    }
  }
`

export async function getNomUsersByNavIdenter(navIdenter: string[]): Promise<NomUserResult[]> {
  if (navIdenter.length === 0) return []

  const result = await queryNom<NomRessurserResponse>(RESSURSER_BY_NAV_IDENT_QUERY, { navIdenter })

  if (result.errors?.length) {
    logger.error('NOM API returned errors', { errors: result.errors })
    throw new Error(`NOM API returned errors: ${result.errors.map((e) => e.message).join(', ')}`)
  }

  return (result.data?.ressurser ?? []).flatMap((r) => (r.ressurs ? [toUserResult(r.ressurs)] : []))
}

export type NomUserLookupResult =
  | { ok: true; navIdent: string; displayName: string; email: string | null }
  | { ok: false; error: string }

interface NomUserLookupMessages {
  unavailable: string
  notFound: string
  missingDisplayName: string
}

export async function resolveNomUserByNavIdent(
  navIdent: string,
  logContext: string,
  messages: NomUserLookupMessages,
): Promise<NomUserLookupResult> {
  let nomResults: NomUserResult[]
  try {
    nomResults = await getNomUsersByNavIdenter([navIdent])
  } catch (error) {
    logger.error(`NOM lookup failed during ${logContext}`, error)
    return { ok: false, error: messages.unavailable }
  }

  const nomUser = nomResults.find((u) => u.navIdent?.toUpperCase() === navIdent.toUpperCase())
  if (!nomUser) {
    return { ok: false, error: messages.notFound }
  }

  const displayName = nomUser.displayName ? formatDisplayNameNatural(nomUser.displayName) : null
  if (!displayName) {
    return { ok: false, error: messages.missingDisplayName }
  }

  return { ok: true, navIdent, displayName, email: nomUser.email }
}

export async function searchNomUsers(query: string): Promise<NomUserResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const isNavIdent = /^[A-Za-z]\d{6}$/.test(trimmed)

  if (isNavIdent) {
    return getNomUsersByNavIdenter([trimmed.toUpperCase()])
  }

  const result = await queryNom<NomSearchRessursResponse>(SEARCH_RESSURS_QUERY, { term: trimmed })

  if (result.errors?.length) {
    logger.error('NOM API returned errors', { errors: result.errors })
    throw new Error(`NOM API returned errors: ${result.errors.map((e) => e.message).join(', ')}`)
  }

  return (result.data?.searchRessurs ?? []).map(toUserResult)
}
