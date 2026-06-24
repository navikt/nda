import { createCookie } from 'react-router'

export const ADMIN_ELEVATED_COOKIE = 'admin-elevated'

const adminElevatedCookie = createCookie(ADMIN_ELEVATED_COOKIE, {
  maxAge: 60 * 60 * 8, // 8 hours
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
})

/**
 * Admin is suppressed (treated as a regular user) unless an explicit elevation
 * cookie is present and set to `true`. Default = suppressed.
 */
export async function isAdminSuppressed(request: Request): Promise<boolean> {
  const value = await adminElevatedCookie.parse(request.headers.get('Cookie'))
  return value !== true
}

export async function serializeAdminElevation(elevate: boolean): Promise<string> {
  return elevate ? adminElevatedCookie.serialize(true) : adminElevatedCookie.serialize('', { maxAge: 0 })
}
