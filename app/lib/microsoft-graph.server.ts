/**
 * Microsoft Graph API client for user search.
 *
 * Uses Client Credentials flow via NAIS Token Endpoint (Texas) to acquire tokens.
 * Requires the application permission User.Read.All with admin consent.
 */

import { logger } from '~/lib/logger.server'

interface GraphToken {
  access_token: string
  expires_in: number
}

interface GraphUser {
  displayName: string | null
  mail: string | null
  onPremisesSamAccountName: string | null
  userPrincipalName: string | null
}

interface GraphSearchResponse {
  value: GraphUser[]
}

export interface GraphUserResult {
  displayName: string | null
  email: string | null
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

  const response = await fetch(tokenEndpoint, {
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

  // Cache with 5 minute buffer before expiry, clamped to avoid negative values
  const bufferSeconds = Math.max(0, Math.min(300, data.expires_in - 60))
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - bufferSeconds) * 1000,
  }

  return data.access_token
}

/**
 * Search for users in Microsoft Graph by name, email, or NAV-ident.
 * Returns up to 10 matching users.
 */
export async function searchGraphUsers(query: string): Promise<GraphUserResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const token = await getAccessToken()

  // Build search/filter depending on input pattern
  const isNavIdent = /^[A-Za-z]\d{6}$/.test(trimmed)
  const isEmail = trimmed.includes('@')

  let url: string
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ConsistencyLevel: 'eventual',
  }

  if (isNavIdent) {
    // Exact match on NAV-ident (stored as onPremisesSamAccountName)
    const sanitized = trimmed.toUpperCase().replace(/'/g, "''")
    const filter = `onPremisesSamAccountName eq '${sanitized}'`
    url = `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filter)}&$select=displayName,mail,onPremisesSamAccountName,userPrincipalName&$top=10`
  } else if (isEmail) {
    // Search by email
    const search = `"mail:${escapeSearchValue(trimmed)}"`
    url = `https://graph.microsoft.com/v1.0/users?$search=${encodeURIComponent(search)}&$select=displayName,mail,onPremisesSamAccountName,userPrincipalName&$count=true&$top=10`
  } else {
    // Search by display name — use OR to get broad results, then filter server-side
    const words = escapeSearchValue(trimmed).split(/\s+/).filter(Boolean)
    const search = words.map((w) => `"displayName:${w}"`).join(' OR ')
    url = `https://graph.microsoft.com/v1.0/users?$search=${encodeURIComponent(search)}&$select=displayName,mail,onPremisesSamAccountName,userPrincipalName&$count=true&$top=25`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    logger.error('Graph API user search failed', { status: response.status })
    throw new Error(`Graph API search failed: ${response.status}`)
  }

  const data: GraphSearchResponse = await response.json()

  let results = data.value.map((user) => ({
    displayName: user.displayName,
    email: user.mail || user.userPrincipalName,
    navIdent: user.onPremisesSamAccountName,
  }))

  // For multi-word queries, filter to users matching ALL words (case-insensitive)
  const words = escapeSearchValue(trimmed).split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    results = results.filter((user) => {
      const name = (user.displayName ?? '').toLowerCase()
      return words.every((w) => name.includes(w.toLowerCase()))
    })
  }

  return results.slice(0, 10)
}

/** Escape characters that are reserved in Graph $search query values. */
function escapeSearchValue(value: string): string {
  return value.replace(/["\\]/g, '')
}
