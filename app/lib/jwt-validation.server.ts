import * as jose from 'jose'

let jwksCache: jose.JWTVerifyGetKey | null = null
let jwksCacheCreatedAt = 0
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000

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

export function isJwtValidationConfigured(): boolean {
  return !!(
    process.env.AZURE_OPENID_CONFIG_JWKS_URI &&
    process.env.AZURE_OPENID_CONFIG_ISSUER &&
    process.env.AZURE_APP_CLIENT_ID
  )
}

async function getJwks(): Promise<jose.JWTVerifyGetKey> {
  const now = Date.now()

  if (jwksCache && now - jwksCacheCreatedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache
  }

  const jwksUri = process.env.AZURE_OPENID_CONFIG_JWKS_URI
  if (!jwksUri) {
    throw new Error('AZURE_OPENID_CONFIG_JWKS_URI not configured')
  }

  jwksCache = jose.createRemoteJWKSet(new URL(jwksUri))
  jwksCacheCreatedAt = now

  return jwksCache
}

export async function validateToken(token: string): Promise<ValidationResult> {
  if (!isJwtValidationConfigured()) {
    return {
      success: false,
      error: {
        code: 'missing_config',
        message: 'JWT validation not configured - missing Azure environment variables',
      },
    }
  }

  const issuer = process.env.AZURE_OPENID_CONFIG_ISSUER as string
  const audience = process.env.AZURE_APP_CLIENT_ID as string

  try {
    const jwks = await getJwks()

    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer,
      audience,
    })

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

    return {
      success: false,
      error: {
        code: 'invalid_token',
        message: err instanceof Error ? err.message : 'Unknown token validation error',
      },
    }
  }
}

function _clearJwksCache(): void {
  jwksCache = null
  jwksCacheCreatedAt = 0
}
