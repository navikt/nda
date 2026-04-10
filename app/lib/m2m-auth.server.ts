/**
 * Machine-to-Machine (M2M) Authentication
 *
 * Validates Bearer tokens from service-to-service calls using the
 * NAIS token introspection endpoint. This is separate from user authentication
 * (auth.server.ts) which validates tokens from Wonderwall with NAVident claims.
 *
 * M2M tokens are issued via client_credentials flow and contain:
 * - idtyp: "app" (identity type)
 * - roles: ["access_as_application"] (default role)
 * - No NAVident or groups claims
 *
 * @see https://doc.nais.io/auth/entra-id/how-to/secure/
 */

import { logger } from './logger.server'

interface IntrospectionSuccessResponse {
  active: true
  aud: string
  azp: string
  azp_name?: string
  exp: number
  iat: number
  iss: string
  idtyp?: string
  roles?: string[]
  sub: string
  tid: string
  ver: string
}

interface IntrospectionErrorResponse {
  active: false
  error: string
}

type IntrospectionResponse = IntrospectionSuccessResponse | IntrospectionErrorResponse

interface M2MTokenPayload {
  /** Client ID of the calling application */
  azp: string
  /** Human-readable name of the calling application */
  azpName?: string
  /** Roles assigned to the calling application */
  roles: string[]
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || authHeader.length < 8) return null
  if (authHeader.slice(0, 7).toLowerCase() !== 'bearer ') return null
  return authHeader.slice(7)
}

/**
 * Validate an M2M token using the NAIS token introspection endpoint.
 *
 * @returns The validated token payload, or null if invalid
 */
async function introspectToken(token: string): Promise<IntrospectionResponse | null> {
  const introspectionEndpoint = process.env.NAIS_TOKEN_INTROSPECTION_ENDPOINT

  if (!introspectionEndpoint) {
    logger.error('NAIS_TOKEN_INTROSPECTION_ENDPOINT not configured')
    return null
  }

  try {
    const response = await fetch(introspectionEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity_provider: 'entra_id',
        token,
      }),
    })

    if (!response.ok) {
      logger.error(`Token introspection endpoint returned ${response.status}`)
      return null
    }

    return (await response.json()) as IntrospectionResponse
  } catch (error) {
    logger.error(`Token introspection failed: ${error}`)
    return null
  }
}

/**
 * Require a valid M2M token on the request.
 *
 * Validates the Bearer token via NAIS token introspection and checks
 * that the token has the `access_as_application` role.
 *
 * @throws {Response} 401 if token is missing or invalid
 * @throws {Response} 403 if token lacks required role
 */
export async function requireM2MToken(request: Request): Promise<M2MTokenPayload> {
  const token = extractBearerToken(request)

  if (!token) {
    throw new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const result = await introspectToken(token)

  if (!result) {
    throw new Response(JSON.stringify({ error: 'Token validation unavailable' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!result.active) {
    logger.warn(`M2M token rejected: ${result.error}`)
    throw new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const expectedAudience = process.env.AZURE_APP_CLIENT_ID
  if (!expectedAudience || result.aud !== expectedAudience) {
    logger.warn(`M2M token audience mismatch. expected: ${expectedAudience}, got: ${result.aud}`)
    throw new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (result.idtyp !== 'app') {
    logger.warn(`M2M token has unexpected identity type: ${result.idtyp}`)
    throw new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const roles = result.roles ?? []
  if (!roles.includes('access_as_application')) {
    logger.warn(`M2M token missing access_as_application role. azp: ${result.azp}, roles: ${roles.join(', ')}`)
    throw new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return {
    azp: result.azp,
    azpName: result.azp_name,
    roles,
  }
}
