/**
 * GitHub Bot User Utilities
 *
 * Handles recognition and display of GitHub bot accounts like dependabot[bot].
 * Bot users should not have user mappings created for them.
 */

interface GitHubBot {
  displayName: string
  description: string
}

/**
 * Known GitHub bot usernames with their display names and descriptions
 */
export const GITHUB_BOTS: Record<string, GitHubBot> = {
  'dependabot[bot]': {
    displayName: 'Dependabot',
    description: 'Automatisk avhengighetsoppdatering fra GitHub. Lager PRs for å oppdatere dependencies.',
  },
  'renovate[bot]': {
    displayName: 'Renovate',
    description: 'Automatisk avhengighetsoppdatering. Alternativ til Dependabot med flere konfigurasjonsvalg.',
  },
  'github-actions[bot]': {
    displayName: 'GitHub Actions',
    description: 'Automatiserte handlinger fra GitHub Actions workflows.',
  },
  'snyk-bot': {
    displayName: 'Snyk',
    description: 'Sikkerhetsverktøy som oppdager og fikser sårbarheter i avhengigheter.',
  },
  'codecov[bot]': {
    displayName: 'Codecov',
    description: 'Kodedekning-rapportering for tester.',
  },
  'sonarcloud[bot]': {
    displayName: 'SonarCloud',
    description: 'Kodekvalitet og sikkerhetsanalyse.',
  },
  'mergify[bot]': {
    displayName: 'Mergify',
    description: 'Automatisk merging og PR-håndtering.',
  },
  'semantic-release-bot': {
    displayName: 'Semantic Release',
    description: 'Automatisk versjonering og release basert på commit-meldinger.',
  },
}

/**
 * Check if a username is a known GitHub bot
 */
export function isGitHubBot(username: string | null | undefined): boolean {
  if (!username) return false
  return username in GITHUB_BOTS || username.endsWith('[bot]')
}

/**
 * Get display name for a bot user, or null if not a bot
 */
export function getBotDisplayName(username: string | null | undefined): string | null {
  if (!username) return null

  // Check known bots first
  if (username in GITHUB_BOTS) {
    return GITHUB_BOTS[username].displayName
  }

  // Handle unknown [bot] users
  if (username.endsWith('[bot]')) {
    // Convert "some-app[bot]" to "Some App (bot)"
    const baseName = username.replace('[bot]', '')
    const displayName = baseName
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return `${displayName} (bot)`
  }

  return null
}

/**
 * Get description for a bot user, or null if not a known bot
 */
export function getBotDescription(username: string | null | undefined): string | null {
  if (!username) return null

  if (username in GITHUB_BOTS) {
    return GITHUB_BOTS[username].description
  }

  // Generic description for unknown bots
  if (username.endsWith('[bot]')) {
    return 'GitHub bot-konto.'
  }

  return null
}
