import { pool } from './connection.server'

export type LandingPage = 'my-teams' | 'sections' | `sections/${string}`

export async function getUserLandingPage(navIdent: string): Promise<LandingPage> {
  const result = await pool.query('SELECT landing_page FROM user_settings WHERE nav_ident = $1', [navIdent])
  return (result.rows[0]?.landing_page as LandingPage) ?? 'my-teams'
}

export async function setUserLandingPage(navIdent: string, landingPage: LandingPage): Promise<void> {
  await pool.query(
    `INSERT INTO user_settings (nav_ident, landing_page, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (nav_ident) DO UPDATE SET landing_page = $2, updated_at = NOW()`,
    [navIdent, landingPage],
  )
}
