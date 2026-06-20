import { getSectionsForEntraGroups } from '~/db/sections.server'
import { isJwtValidationConfigured, validateToken } from './jwt-validation.server'
import { logger } from './logger.server'

const FALLBACK_GROUP_ADMIN = '1e97cbc6-0687-4d23-aebd-c611035279c1'

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
  entraGroups: string[]
}

async function getRoleFromGroups(groups: string[] | undefined): Promise<UserRole> {
  if (!groups || groups.length === 0) return 'user'

  try {
    const sections = await getSectionsForEntraGroups(groups)
    if (sections.some((s) => s.role === 'admin')) return 'admin'
  } catch (error) {
    logger.warn(`Could not resolve sections from DB, falling back to hardcoded admin group: ${error}`)
  }

  if (groups.includes(FALLBACK_GROUP_ADMIN)) return 'admin'
  return 'user'
}

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

export async function getUserIdentity(request: Request): Promise<UserIdentity | null> {
  const authHeader = request.headers.get('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

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

      logger.warn(`JWT validation failed: ${result.error.code} - ${result.error.message}`)
      return null
    }
  }

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

export async function requireUser(request: Request): Promise<UserIdentity> {
  const user = await getUserIdentity(request)
  if (!user) {
    throw new Response('Forbidden - no valid authorization', { status: 403 })
  }
  return user
}

export async function requireAdmin(request: Request): Promise<UserIdentity> {
  const user = await getUserIdentity(request)
  if (!user || user.role !== 'admin') {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }
  return user
}
