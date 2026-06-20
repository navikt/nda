interface GitHubBot {
  displayName: string
  description: string
}

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

export const NON_BRACKET_BOT_USERNAMES = Object.keys(GITHUB_BOTS)
  .filter((u) => !u.endsWith('[bot]'))
  .map((u) => u.toLowerCase())

export function isGitHubBot(username: string | null | undefined): boolean {
  if (!username) return false
  return username in GITHUB_BOTS || username.endsWith('[bot]')
}

export function getBotDisplayName(username: string | null | undefined): string | null {
  if (!username) return null

  if (username in GITHUB_BOTS) {
    return GITHUB_BOTS[username].displayName
  }

  if (username.endsWith('[bot]')) {
    const baseName = username.replace('[bot]', '')
    const displayName = baseName
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return `${displayName} (bot)`
  }

  return null
}

export function getBotDescription(username: string | null | undefined): string | null {
  if (!username) return null

  if (username in GITHUB_BOTS) {
    return GITHUB_BOTS[username].description
  }

  if (username.endsWith('[bot]')) {
    return 'GitHub bot-konto.'
  }

  return null
}
