import { fetchWithLogging, logger } from '~/lib/logger.server'

interface GraphToken {
  access_token: string
  expires_in: number
}

interface GraphUser {
  displayName: string | null
  onPremisesSamAccountName: string | null
}

interface GraphSearchResponse {
  value: GraphUser[]
}

export interface GraphUserResult {
  displayName: string | null
  navIdent: string | null
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

  const response = await fetchWithLogging('microsoft_graph', tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity_provider: 'entra_id',
      target: 'https://graph.microsoft.com/.default',
    }),
  })

  if (!response.ok) {
    logger.error('Failed to acquire Graph API token', { status: response.status })
    throw new Error(`Token acquisition failed: ${response.status}`)
  }

  const data: GraphToken = await response.json()

  const bufferSeconds = Math.max(0, Math.min(300, data.expires_in - 60))
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - bufferSeconds) * 1000,
  }

  return data.access_token
}

export async function searchGraphUsers(query: string): Promise<GraphUserResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const token = await getAccessToken()

  const isNavIdent = /^[A-Za-z]\d{6}$/.test(trimmed)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ConsistencyLevel: 'eventual',
  }

  const select = '$select=displayName,onPremisesSamAccountName'

  if (isNavIdent) {
    const sanitized = trimmed.toUpperCase().replace(/'/g, "''")
    const filter = `onPremisesSamAccountName eq '${sanitized}'`
    const url = `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filter)}&${select}&$count=true&$top=10`
    return fetchGraphUsers(url, headers)
  }

  const words = escapeSearchValue(trimmed).split(/\s+/).filter(Boolean)
  const search = words.map((w) => `"displayName:${w}"`).join(' ')
  const url = `https://graph.microsoft.com/v1.0/users?$search=${encodeURIComponent(search)}&${select}&$count=true&$top=10`
  return fetchGraphUsers(url, headers)
}

async function fetchGraphUsers(url: string, headers: Record<string, string>): Promise<GraphUserResult[]> {
  const response = await fetchWithLogging('microsoft_graph', url, { headers })

  if (!response.ok) {
    logger.error('Graph API user search failed', { status: response.status })
    throw new Error(`Graph API search failed: ${response.status}`)
  }

  const data: GraphSearchResponse = await response.json()

  return data.value.map((user) => ({
    displayName: user.displayName,
    navIdent: user.onPremisesSamAccountName,
  }))
}

function escapeSearchValue(value: string): string {
  return value.replace(/["\\]/g, '')
}
