/**
 * JWT Token Validation with JWKS
 *
 * Validates JWT tokens from Azure AD using JWKS (JSON Web Key Set).
 * This provides cryptographic verification of token signatures in addition
 * to the validation already performed by Wonderwall.
 *
 * Environment variables (injected by Nais when azure.sidecar.enabled):
 * - AZURE_OPENID_CONFIG_JWKS_URI: JWKS endpoint for public keys
 * - AZURE_OPENID_CONFIG_ISSUER: Expected token issuer
 * - AZURE_APP_CLIENT_ID: Our app's client ID (expected audience)
 */

import * as jose from 'jose'

// Cache for JWKS to avoid fetching on every request
let jwksCache: jose.JWTVerifyGetKey | null = null
let jwksCacheCreatedAt = 0
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface ValidatedTokenPayload {
  navIdent: string
  name?: string
  email?: string
  groups: string[]
}

interface ValidationError {
  code: 'missing_config' | 'invalid_token' | 'expired' | 'invalid_signature' | 'invalid_claims'
  message: string
}

type ValidationResult = { success: true; payload: ValidatedTokenPayload } | { success: false; error: ValidationError }

/**
 * Check if JWT validation is configured (running in Nais with Azure sidecar)
 */
export function isJwtValidationConfigured(): boolean {
  return !!(
    process.env.AZURE_OPENID_CONFIG_JWKS_URI &&
    process.env.AZURE_OPENID_CONFIG_ISSUER &&
    process.env.AZURE_APP_CLIENT_ID
  )
}

/**
 * Get or create JWKS key set with caching
 */
async function getJwks(): Promise<jose.JWTVerifyGetKey> {
  const now = Date.now()

  // Return cached JWKS if still valid
  if (jwksCache && now - jwksCacheCreatedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache
  }

  const jwksUri = process.env.AZURE_OPENID_CONFIG_JWKS_URI
  if (!jwksUri) {
    throw new Error('AZURE_OPENID_CONFIG_JWKS_URI not configured')
  }

  // Create new JWKS with remote key set
  jwksCache = jose.createRemoteJWKSet(new URL(jwksUri))
  jwksCacheCreatedAt = now

  return jwksCache
}

/**
 * Validate a JWT token with full cryptographic verification
 *
 * Validates:
 * - Signature (using JWKS from Azure AD)
 * - Expiration (exp claim)
 * - Issuer (iss claim)
 * - Audience (aud claim)
 * - Required claims (NAVident, groups)
 */
export async function validateToken(token: string): Promise<ValidationResult> {
  // Check configuration
  if (!isJwtValidationConfigured()) {
    return {
      success: false,
      error: {
        code: 'missing_config',
        message: 'JWT validation not configured - missing Azure environment variables',
      },
    }
  }

  // Safe to access after isJwtValidationConfigured() check
  const issuer = process.env.AZURE_OPENID_CONFIG_ISSUER as string
  const audience = process.env.AZURE_APP_CLIENT_ID as string

  try {
    const jwks = await getJwks()

    // Verify token signature and standard claims
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer,
      audience,
    })

    // Extract NAV-specific claims
    const navIdent = (payload.NAVident as string) || (payload.navident as string)
    const groups = (payload.groups as string[]) || []
    const name = payload.name as string | undefined
    const email = (payload.email as string) || (payload.preferred_username as string) || undefined

    if (!navIdent) {
      return {
        success: false,
        error: {
          code: 'invalid_claims',
          message: 'Token missing required NAVident claim',
        },
      }
    }

    return {
      success: true,
      payload: {
        navIdent,
        name,
        email,
        groups,
      },
    }
  } catch (err) {
    // Handle specific jose errors
    if (err instanceof jose.errors.JWTExpired) {
      return {
        success: false,
        error: {
          code: 'expired',
          message: 'Token has expired',
        },
      }
    }

    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      return {
        success: false,
        error: {
          code: 'invalid_signature',
          message: 'Token signature verification failed',
        },
      }
    }

    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      return {
        success: false,
        error: {
          code: 'invalid_claims',
          message: `Token claim validation failed: ${err.message}`,
        },
      }
    }

    // Generic token error
    return {
      success: false,
      error: {
        code: 'invalid_token',
        message: err instanceof Error ? err.message : 'Unknown token validation error',
      },
    }
  }
}

/**
 * Clear the JWKS cache (useful for testing or key rotation)
 */
function clearJwksCache(): void {
  jwksCache = null
  jwksCacheCreatedAt = 0
}
