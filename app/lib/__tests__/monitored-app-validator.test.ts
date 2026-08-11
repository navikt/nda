import { describe, expect, it } from 'vitest'
import { classifyAll, classifyRow, type MonitoredRow, type NaisAppEntry } from '../monitored-app-validator'

const nais: NaisAppEntry[] = [
  { teamSlug: 'pensjonselvbetjening', appName: 'dinpensjon-frontend-borger', environmentName: 'prod-gcp' },
  { teamSlug: 'pensjonselvbetjening', appName: 'pensjon-saksoversikt-frontend-borger', environmentName: 'prod-gcp' },
  {
    teamSlug: 'pensjonselvbetjening',
    appName: 'pensjon-selvbetjening-soknad-alder-frontend',
    environmentName: 'prod-gcp',
  },
  {
    teamSlug: 'pensjonselvbetjening',
    appName: 'pensjon-selvbetjening-soknad-alder-frontend',
    environmentName: 'dev-gcp',
  },
  { teamSlug: 'pensjondeployer', appName: 'pensjon-pen', environmentName: 'prod-fss' },
]

const wrap = (row: MonitoredRow) => classifyAll([row], nais)[0]

describe('classifyRow', () => {
  it('returns ok when team/env/app exists in Nais', () => {
    expect(
      wrap({
        id: 1,
        team_slug: 'pensjondeployer',
        environment_name: 'prod-fss',
        app_name: 'pensjon-pen',
      }).status,
    ).toBe('ok')
  })

  it('detects swapped team/app in same env and suggests the swap', () => {
    const result = wrap({
      id: 2,
      team_slug: 'pensjon-pen',
      environment_name: 'prod-fss',
      app_name: 'pensjondeployer',
    })
    expect(result.status).toBe('swapped')
    expect(result.suggested).toEqual({
      team_slug: 'pensjondeployer',
      environment_name: 'prod-fss',
      app_name: 'pensjon-pen',
    })
  })

  it('detects swapped team/app in wrong env and suggests correct env', () => {
    const result = wrap({
      id: 3,
      team_slug: 'dinpensjon-frontend-borger',
      environment_name: 'prod-fss',
      app_name: 'pensjonselvbetjening',
    })
    expect(result.status).toBe('swapped_wrong_env')
    expect(result.suggested).toEqual({
      team_slug: 'pensjonselvbetjening',
      environment_name: 'prod-gcp',
      app_name: 'dinpensjon-frontend-borger',
    })
  })

  it('detects wrong env when same orientation exists elsewhere', () => {
    const result = wrap({
      id: 4,
      team_slug: 'pensjonselvbetjening',
      environment_name: 'prod-fss',
      app_name: 'dinpensjon-frontend-borger',
    })
    expect(result.status).toBe('wrong_env')
    expect(result.suggested?.environment_name).toBe('prod-gcp')
  })

  it('returns wrong_env without suggestion when multiple envs match', () => {
    const result = wrap({
      id: 5,
      team_slug: 'pensjonselvbetjening',
      environment_name: 'prod-fss',
      app_name: 'pensjon-selvbetjening-soknad-alder-frontend',
    })
    expect(result.status).toBe('wrong_env')
    expect(result.suggested).toBeNull()
    expect(result.candidates.map((c) => c.environment_name).sort()).toEqual(['dev-gcp', 'prod-gcp'])
  })

  it('returns missing when nothing matches in either orientation', () => {
    const result = wrap({
      id: 6,
      team_slug: 'ghost-team',
      environment_name: 'prod-gcp',
      app_name: 'ghost-app',
    })
    expect(result.status).toBe('missing')
    expect(result.suggested).toBeNull()
  })

  it('classifyAll preserves input order', () => {
    const rows: MonitoredRow[] = [
      { id: 10, team_slug: 'pensjondeployer', environment_name: 'prod-fss', app_name: 'pensjon-pen' },
      { id: 11, team_slug: 'ghost', environment_name: 'prod-gcp', app_name: 'ghost' },
    ]
    const out = classifyAll(rows, nais)
    expect(out.map((r) => r.id)).toEqual([10, 11])
    expect(out.map((r) => r.status)).toEqual(['ok', 'missing'])
  })
})

describe('classifyRow (using classifyRow directly is redundant — covered by classifyAll)', () => {
  it('matches the function export', () => {
    expect(typeof classifyRow).toBe('function')
  })
})
