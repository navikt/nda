import { createCookie } from 'react-router'

export type ThemeValue = 'light' | 'dark'

const themeCookie = createCookie('theme', {
  maxAge: 60 * 60 * 24 * 365, // 1 year
  sameSite: 'lax',
  path: '/',
})

export async function getTheme(request: Request): Promise<ThemeValue> {
  const cookieHeader = request.headers.get('Cookie')
  const theme = await themeCookie.parse(cookieHeader)
  return theme === 'dark' ? 'dark' : 'light'
}

export async function setThemeCookie(theme: ThemeValue): Promise<string> {
  return themeCookie.serialize(theme)
}
