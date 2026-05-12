/**
 * Authentication utilities for extracting user identity from tokens.
 *
 * In production (Nais), Wonderwall login proxy adds Bearer tokens with NAV-ident claims.
 * Tokens are validated using JWKS from Azure AD for cryptographic verification.
 * In development, we fall back to a mock identity from environment variables.
 *
 * Role and section membership is resolved from Entra ID groups stored in the sections table.
 */

import { getSectionsForEntraGroups } from '~/db/sections.server'
import { isJwtValidationConfigured, validateToken } from './jwt-validation.server'
import { logger } from './logger.server'

// Fallback admin group ID — checked when no section grants admin or when the DB lookup fails
const FALLBACK_GROUP_ADMIN = '1e97cbc6-0687-4d23-aebd-c611035279c1' // pensjon-revisjon

type UserRole = 'admin' | 'user'

interface UserSection {
  id: number
  slug: string
  name: string
  role: UserRole
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

function isInNaisCluster(): boolean {
  return !!process.env.NAIS_CLUSTER_NAME
}

export interface UserIdentity {
  navIdent: string
  name?: string
  email?: string
  role: UserRole
  /** The user's Entra ID group IDs from the JWT token */
  entraGroups: string[]
}

/**
 * Determine user role from group memberships.
 * All authenticated users default to 'user' role. Admin role is granted
 * if the user belongs to a section admin group or the fallback admin group.
 */
async function getRoleFromGroups(groups: string[] | undefined): Promise<UserRole> {
  if (!groups || groups.length === 0) return 'user'

  // Try DB-based section groups first
  try {
    const sections = await getSectionsForEntraGroups(groups)
    if (sections.some((s) => s.role === 'admin')) return 'admin'
  } catch (error) {
    logger.warn(`Could not resolve sections from DB, falling back to hardcoded admin group: ${error}`)
  }

  // Fallback to hardcoded admin group (for backwards compatibility)
  if (groups.includes(FALLBACK_GROUP_ADMIN)) return 'admin'
  return 'user'
}

/**
 * Resolve user's section memberships from their Entra ID groups.
 */
export async function getUserSections(entraGroups: string[]): Promise<UserSection[]> {
  if (entraGroups.length === 0) return []

  try {
    const sections = await getSectionsForEntraGroups(entraGroups)
    return sections.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      role: s.role,
    }))
  } catch (error) {
    logger.warn(`Could not resolve user sections: ${error}`)
    return []
  }
}

/**
 * Extract user identity from request.
 *
 * - In production: Validates JWT token cryptographically using JWKS
 * - In development (outside cluster): Falls back to DEV_NAV_IDENT and DEV_USER_ROLE env vars
 *
 * @returns UserIdentity if authenticated and authorized, null otherwise
 */
export async function getUserIdentity(request: Request): Promise<UserIdentity | null> {
  const authHeader = request.headers.get('Authorization')

  // Try to validate real token (works in both dev and prod if configured)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // Use full JWT validation if configured (in Nais cluster)
    if (isJwtValidationConfigured()) {
      const result = await validateToken(token)

      if (result.success) {
        const groups = result.payload.groups ?? []
        const role = await getRoleFromGroups(groups)

        return {
          navIdent: result.payload.navIdent,
          name: result.payload.name,
          email: result.payload.email,
          role,
          entraGroups: groups,
        }
      }

      // Token validation failed
      logger.warn(`JWT validation failed: ${result.error.code} - ${result.error.message}`)
      return null
    }
  }

  // Development fallback - ONLY when:
  // 1. No valid token found AND
  // 2. Running in development mode AND
  // 3. NOT running in a Nais cluster
  if (isDevelopment() && !isInNaisCluster()) {
    const devIdent = process.env.DEV_NAV_IDENT
    const devRole = process.env.DEV_USER_ROLE as UserRole | undefined

    if (devIdent && devRole && (devRole === 'admin' || devRole === 'user')) {
      logger.warn(`⚠️ DEV MODE: Using mock identity - NAV-ident: ${devIdent}, role: ${devRole}`)
      return {
        navIdent: devIdent,
        name: 'Development User',
        role: devRole,
        entraGroups: [],
      }
    }
  }

  return null
}

/**
 * Require user to be authenticated with at least 'user' role.
 * Throws 403 Response if not authorized.
 */
export async function requireUser(request: Request): Promise<UserIdentity> {
  const user = await getUserIdentity(request)
  if (!user) {
    throw new Response('Forbidden - no valid authorization', { status: 403 })
  }
  return user
}

/**
 * Require user to be authenticated with 'admin' role.
 * Throws 403 Response if not authorized.
 */
export async function requireAdmin(request: Request): Promise<UserIdentity> {
  const user = await getUserIdentity(request)
  if (!user || user.role !== 'admin') {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }
  return user
}
