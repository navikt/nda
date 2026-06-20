import type {
  DeploymentNotification,
  DeviationNotification,
  HomeTabInput,
  NewDeploymentNotification,
  ReminderNotification,
} from '~/lib/slack'

const BASE_URL = 'https://nda.ansatt.nav.no'

const base = {
  deploymentId: 42,
  appName: 'pensjon-pen',
  environmentName: 'prod-gcp',
  teamSlug: 'pensjondeployer',
  commitSha: 'abc1234def5678',
  deployerName: 'Ola Nordmann',
  deployerUsername: 'o123456',
  detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen/deployments/42`,
} satisfies Omit<DeploymentNotification, 'status'>

export const deploymentFixtures = {
  unverified: {
    ...base,
    status: 'unverified' as const,
    commitMessage: 'feat: legg til ny pensjonsberegning for AFP',
    prNumber: 123,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/123',
  },

  unverifiedWithoutPr: {
    ...base,
    status: 'unverified' as const,
    commitMessage: 'hotfix: fiks kritisk feil i pensjonsberegning',
  },

  pending: {
    ...base,
    status: 'pending_approval' as const,
    prNumber: 456,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/456',
    commitMessage: 'chore: oppdater avhengigheter',
  },

  approved: {
    ...base,
    status: 'approved' as const,
    prNumber: 789,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/789',
    commitMessage: 'fix: korriger beregning av uføretrygd',
  },

  rejected: {
    ...base,
    status: 'rejected' as const,
    commitMessage: 'Merge branch "feature/experimental" into main',
  },

  longCommitMessage: {
    ...base,
    status: 'unverified' as const,
    commitMessage:
      'feat: implementer ny beregningsmodell for alderspensjon med støtte for gradert uttak og fleksibelt uttak fra 62 år med nye samordningsregler',
    prNumber: 999,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/999',
  },
} satisfies Record<string, DeploymentNotification>

const sampleBoards = [
  {
    id: 1,
    period_label: 'T1 2026',
    team_name: 'Skjermbildemodernisering',
    team_slug: 'skjermbildemodernisering',
    section_slug: 'pensjon',
    objectives: [
      {
        id: 11,
        title: 'Forbedre brukeropplevelse i saksbehandlerverktøy',
        keywords: ['saksbehandler', 'sbh-modernisering'],
        key_results: [
          {
            id: 111,
            title: 'Lansere ny saksbehandlerflyt i Q1',
            keywords: ['saksbehandler-flyt', 'ny-flyt'],
          },
          {
            id: 112,
            title: 'Redusere klikk per oppgave med 30%',
            keywords: ['klikk-reduksjon'],
          },
        ],
      },
      {
        id: 12,
        title: 'Modernisere komponentbibliotek',
        keywords: [],
        key_results: [
          {
            id: 121,
            title: 'Migrere alle skjemaer til Aksel',
            keywords: ['aksel-migrering'],
          },
        ],
      },
    ],
  },
  {
    id: 2,
    period_label: 'T1 2026',
    team_name: 'Starte pensjon',
    team_slug: 'starte-pensjon',
    section_slug: 'pensjon',
    objectives: [
      {
        id: 21,
        title: 'Lansere ny pensjonskalkulator',
        keywords: ['pensjonskalkulator'],
        key_results: [
          {
            id: 211,
            title: 'Stabilisere beregningsmotor',
            keywords: ['beregningsmotor', 'stabilisering'],
          },
        ],
      },
    ],
  },
]

export const homeTabFixtures = {
  withIssues: {
    slackUserId: 'U12345678',
    githubUsername: 'ola-nordmann',
    navIdent: 'O123456',
    baseUrl: BASE_URL,
    boards: sampleBoards,
    teamIssues: {
      appsWithIssuesCount: 3,
      withoutFourEyes: 15,
      pendingVerification: 3,
      alertCount: 1,
      missingGoalLinks: 8,
      unmappedContributors: ['external-contractor', 'summer-intern'],
    },
    personalMissingGoalLinks: 8,
  },

  noIssues: {
    slackUserId: 'U12345678',
    githubUsername: 'kari-nordmann',
    navIdent: 'K654321',
    baseUrl: BASE_URL,
    boards: [sampleBoards[0]],
    teamIssues: {
      appsWithIssuesCount: 0,
      withoutFourEyes: 0,
      pendingVerification: 0,
      alertCount: 0,
      missingGoalLinks: 0,
      unmappedContributors: [],
    },
    personalMissingGoalLinks: 0,
  },

  noGithubUser: {
    slackUserId: 'U99999999',
    githubUsername: null,
    navIdent: 'P987654',
    baseUrl: BASE_URL,
    boards: [sampleBoards[0]],
    teamIssues: {
      appsWithIssuesCount: 1,
      withoutFourEyes: 2,
      pendingVerification: 1,
      alertCount: 0,
      missingGoalLinks: 0,
      unmappedContributors: [],
    },
    personalMissingGoalLinks: null,
  },

  noBoards: {
    slackUserId: 'U11111111',
    githubUsername: 'per-deploy',
    navIdent: 'P111111',
    baseUrl: BASE_URL,
    boards: [],
    teamIssues: {
      appsWithIssuesCount: 0,
      withoutFourEyes: 0,
      pendingVerification: 0,
      alertCount: 0,
      missingGoalLinks: 0,
      unmappedContributors: [],
    },
    personalMissingGoalLinks: 0,
  },

  noMapping: {
    slackUserId: 'U22222222',
    githubUsername: null,
    navIdent: null,
    baseUrl: BASE_URL,
    boards: [],
    teamIssues: {
      appsWithIssuesCount: 0,
      withoutFourEyes: 0,
      pendingVerification: 0,
      alertCount: 0,
      missingGoalLinks: 0,
      unmappedContributors: [],
    },
    personalMissingGoalLinks: null,
  },
} satisfies Record<string, HomeTabInput>

export const deviationFixtures = {
  standard: {
    deploymentId: 42,
    appName: 'pensjon-pen',
    environmentName: 'prod-gcp',
    teamSlug: 'pensjondeployer',
    commitSha: 'abc1234def5678',
    reason:
      'Deployment inneholder endringer som ikke var godkjent gjennom standard PR-prosess. Hastefix for kritisk feil i produksjon.',
    breachType: 'Brudd på rutine for endringshåndtering',
    intent: 'accidental',
    severity: 'high',
    followUpRole: 'delivery_lead',
    registeredByName: 'Kari Nordmann',
    detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen/deployments/42`,
  },

  shortReason: {
    deploymentId: 99,
    appName: 'pensjon-selvbetjening',
    environmentName: 'prod-gcp',
    teamSlug: 'pensjondeployer',
    commitSha: '9876abcdef1234',
    reason: 'Direct push til main uten PR.',
    registeredByName: 'Ola Nordmann',
    detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-selvbetjening/deployments/99`,
  },

  critical: {
    deploymentId: 150,
    appName: 'pensjon-opptjening',
    environmentName: 'prod-gcp',
    teamSlug: 'pensjondeployer',
    commitSha: 'deadbeef12345678',
    reason:
      'Deployment med uautorisert tilgang til personopplysninger. Mulig GDPR-brudd oppdaget i kode som ble deployet uten godkjenning.',
    breachType: 'Brudd på personvernforordningen (GDPR)',
    intent: 'malicious',
    severity: 'critical',
    followUpRole: 'section_lead',
    registeredByName: 'Per Hansen',
    detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-opptjening/deployments/150`,
  },
} satisfies Record<string, DeviationNotification>

const appUrl = `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen`

const reminderBase = {
  appName: 'pensjon-pen',
  environmentName: 'prod-gcp',
  teamSlug: 'pensjondeployer',
  deploymentsListUrl: `${appUrl}/deployments?status=not_approved&period=all`,
} satisfies Omit<ReminderNotification, 'deployments'>

export const reminderFixtures = {
  singleDeployment: {
    ...reminderBase,
    deployments: [
      {
        id: 9700,
        commitSha: 'abc1234def5678',
        commitMessage: 'feat: legg til ny pensjonsberegning for AFP',
        deployerName: 'Ola Nordmann',
        status: 'unverified',
        createdAt: '13. feb. 2026, 10:30',
        detailsUrl: `${appUrl}/deployments/9700`,
      },
    ],
  },

  fewDeployments: {
    ...reminderBase,
    deployments: [
      {
        id: 9700,
        commitSha: 'abc1234def5678',
        commitMessage: 'feat: legg til ny pensjonsberegning for AFP',
        deployerName: 'Ola Nordmann',
        status: 'unverified',
        createdAt: '13. feb. 2026, 10:30',
        detailsUrl: `${appUrl}/deployments/9700`,
      },
      {
        id: 9698,
        commitSha: 'def5678abc1234',
        commitMessage: 'chore: bump dependencies',
        deployerName: 'Kari Nordmann',
        status: 'pending_approval',
        createdAt: '12. feb. 2026, 14:15',
        detailsUrl: `${appUrl}/deployments/9698`,
      },
      {
        id: 9695,
        commitSha: '9876abcdef1234',
        commitMessage: 'hotfix: fiks kritisk feil i beregning',
        deployerName: 'Per Hansen',
        status: 'unverified',
        createdAt: '11. feb. 2026, 09:00',
        detailsUrl: `${appUrl}/deployments/9695`,
      },
    ],
  },

  manyDeployments: {
    ...reminderBase,
    deployments: Array.from({ length: 12 }, (_, i) => ({
      id: 9700 - i,
      commitSha: `${String(i).padStart(7, 'a')}b${String(i).padStart(6, 'c')}`,
      commitMessage: `fix: endring nummer ${i + 1}`,
      deployerName: i % 2 === 0 ? 'Ola Nordmann' : 'Kari Nordmann',
      status: i % 3 === 0 ? 'unverified' : 'pending_approval',
      createdAt: `${13 - Math.floor(i / 2)}. feb. 2026, ${9 + (i % 8)}:00`,
      detailsUrl: `${appUrl}/deployments/${9700 - i}`,
    })),
  },
} satisfies Record<string, ReminderNotification>

const deployNotifyBase = {
  deploymentId: 42,
  appName: 'pensjon-pen',
  environmentName: 'prod-gcp',
  teamSlug: 'pensjondeployer',
  commitSha: 'abc1234def5678',
  deployerUsername: 'o123456',
  detailsUrl: `${BASE_URL}/team/pensjondeployer/env/prod-gcp/app/pensjon-pen/deployments/42`,
} satisfies Partial<NewDeploymentNotification>

export const newDeploymentFixtures = {
  withPr: {
    ...deployNotifyBase,
    fourEyesStatus: 'verified',
    deployMethod: 'pull_request' as const,
    prTitle: 'feat: legg til ny pensjonsberegning for AFP',
    prNumber: 123,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/123',
    prCreator: 'ola.nordmann',
    prApprovers: ['kari.nordmann', 'per.hansen'],
    prMerger: 'kari.nordmann',
    branchName: 'feature/afp-beregning',
    commitsCount: 3,
  },

  directPush: {
    ...deployNotifyBase,
    fourEyesStatus: 'no_pr',
    deployMethod: 'direct_push' as const,
  },

  violation: {
    ...deployNotifyBase,
    fourEyesStatus: 'self_approved',
    deployMethod: 'pull_request' as const,
    prTitle: 'hotfix: fiks kritisk feil i beregning',
    prNumber: 456,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/456',
    prCreator: 'per.hansen',
    prApprovers: [],
    prMerger: 'per.hansen',
    branchName: 'hotfix/beregning',
    commitsCount: 1,
  },

  legacy: {
    ...deployNotifyBase,
    fourEyesStatus: 'legacy_verified',
    deployMethod: 'legacy' as const,
    prTitle: 'chore: bump dependencies',
    prNumber: 789,
    prUrl: 'https://github.com/navikt/pensjon-pen/pull/789',
    prCreator: 'dependabot[bot]',
    prApprovers: ['ola.nordmann'],
    prMerger: 'ola.nordmann',
    branchName: 'dependabot/npm/lodash-4.17.21',
    commitsCount: 1,
  },
} satisfies Record<string, NewDeploymentNotification>
