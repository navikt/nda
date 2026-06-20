import { query } from '~/db/connection.server'
import { logger } from '~/lib/logger.server'

export async function loader() {
  try {
    await query('SELECT 1')
    return new Response('OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (error) {
    logger.error('Readiness check failed:', error)
    return new Response('Database connection failed', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
