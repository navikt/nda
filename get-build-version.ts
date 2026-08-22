import { execSync } from 'node:child_process'

export function getBuildVersion(): string {
  const now = new Date()
  const time = now
    .toLocaleString('sv-SE', { timeZone: 'Europe/Oslo', hour12: false })
    .replace(/[-: ]/g, (m) => (m === ' ' ? '-' : m === ':' ? '.' : '.'))
    .replace(',', '')
    .slice(0, 16)

  let sha: string
  if (process.env.GITHUB_SHA) {
    sha = process.env.GITHUB_SHA.substring(0, 12)
  } else {
    try {
      sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      sha = 'unknown'
    }
  }

  return `${time}-${sha}`
}
