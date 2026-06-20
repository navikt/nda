export interface MonitoredRow {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
}

export interface NaisAppEntry {
  teamSlug: string
  appName: string
  environmentName: string
}

export type ValidationStatus = 'ok' | 'swapped' | 'wrong_env' | 'swapped_wrong_env' | 'missing'

interface ValidationResult {
  id: number
  stored: { team_slug: string; environment_name: string; app_name: string }
  status: ValidationStatus
  suggested: { team_slug: string; environment_name: string; app_name: string } | null
}

interface NaisIndex {
  exact: Set<string>
  envsForPair: Map<string, string[]>
}

function buildIndex(naisApps: NaisAppEntry[]): NaisIndex {
  const exact = new Set<string>()
  const envsForPair = new Map<string, string[]>()
  for (const app of naisApps) {
    const key = `${app.teamSlug}|${app.environmentName}|${app.appName}`
    exact.add(key)
    const pairKey = `${app.teamSlug}|${app.appName}`
    const list = envsForPair.get(pairKey)
    if (list) {
      if (!list.includes(app.environmentName)) list.push(app.environmentName)
    } else {
      envsForPair.set(pairKey, [app.environmentName])
    }
  }
  return { exact, envsForPair }
}

export function classifyRow(row: MonitoredRow, index: NaisIndex): ValidationResult {
  const stored = {
    team_slug: row.team_slug,
    environment_name: row.environment_name,
    app_name: row.app_name,
  }

  const exactKey = `${row.team_slug}|${row.environment_name}|${row.app_name}`
  if (index.exact.has(exactKey)) {
    return { id: row.id, stored, status: 'ok', suggested: null }
  }

  const sameOrientationEnvs = index.envsForPair.get(`${row.team_slug}|${row.app_name}`)
  const swapKeySameEnv = `${row.app_name}|${row.environment_name}|${row.team_slug}`
  const swapOrientationEnvs = index.envsForPair.get(`${row.app_name}|${row.team_slug}`)

  if (sameOrientationEnvs && sameOrientationEnvs.length > 0) {
    if (sameOrientationEnvs.length === 1) {
      return {
        id: row.id,
        stored,
        status: 'wrong_env',
        suggested: {
          team_slug: row.team_slug,
          environment_name: sameOrientationEnvs[0],
          app_name: row.app_name,
        },
      }
    }
    return { id: row.id, stored, status: 'wrong_env', suggested: null }
  }

  if (index.exact.has(swapKeySameEnv)) {
    return {
      id: row.id,
      stored,
      status: 'swapped',
      suggested: {
        team_slug: row.app_name,
        environment_name: row.environment_name,
        app_name: row.team_slug,
      },
    }
  }

  if (swapOrientationEnvs && swapOrientationEnvs.length > 0) {
    if (swapOrientationEnvs.length === 1) {
      return {
        id: row.id,
        stored,
        status: 'swapped_wrong_env',
        suggested: {
          team_slug: row.app_name,
          environment_name: swapOrientationEnvs[0],
          app_name: row.team_slug,
        },
      }
    }
    return { id: row.id, stored, status: 'swapped_wrong_env', suggested: null }
  }

  return { id: row.id, stored, status: 'missing', suggested: null }
}

export function classifyAll(rows: MonitoredRow[], naisApps: NaisAppEntry[]): ValidationResult[] {
  const index = buildIndex(naisApps)
  return rows.map((r) => classifyRow(r, index))
}
