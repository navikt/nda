import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryIdBackfillCoverage } from '~/components/RepositoryIdBackfillCoverage'

const meta: Meta<typeof RepositoryIdBackfillCoverage> = {
  title: 'Pages/RepositoryIdBackfillCoverage',
  component: RepositoryIdBackfillCoverage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof RepositoryIdBackfillCoverage>

export const Default: Story = {
  args: {
    teams: ['pensjondeployer', 'team-a'],
    selectedTeam: 'pensjondeployer',
    invalidTeam: false,
    repositories: [
      {
        repositoryId: 216,
        githubOwner: 'navikt',
        githubRepoName: 'pensjon-alde',
        totalLegacyDeployments: 12,
        eligible: 5,
        noTriggerUrl: 1,
        invalidTriggerUrl: 1,
        triggerUrlMismatch: 1,
        missingSnapshot: 1,
        repositoryMismatch: 1,
        shaMismatch: 1,
        unsupportedEvent: 1,
        headRepositoryMismatch: 0,
        backfillJob: null,
      },
    ],
    totals: { legacy: 12, eligible: 5 },
    previewRepository: null,
    previewDeployments: [],
    invalidRepository: false,
    returnToTeam: null,
  },
}

export const SelectTeam: Story = {
  name: 'Velg team før rapport',
  args: {
    teams: ['pensjondeployer', 'team-a'],
    selectedTeam: null,
    invalidTeam: false,
    repositories: [],
    totals: { legacy: 0, eligible: 0 },
    previewRepository: null,
    previewDeployments: [],
    invalidRepository: false,
    returnToTeam: null,
  },
}

export const Empty: Story = {
  name: 'Ingen eldre deployments',
  args: {
    teams: ['pensjondeployer', 'team-a'],
    selectedTeam: 'pensjondeployer',
    invalidTeam: false,
    repositories: [],
    totals: { legacy: 0, eligible: 0 },
    previewRepository: null,
    previewDeployments: [],
    invalidRepository: false,
    returnToTeam: null,
  },
}

export const RepositoryPreview: Story = {
  name: 'Forhåndsvisning på tvers av team',
  args: {
    teams: [],
    selectedTeam: null,
    invalidTeam: false,
    repositories: [],
    totals: { legacy: 183, eligible: 108 },
    previewRepository: {
      repositoryId: 216,
      githubOwner: 'navikt',
      githubRepoName: 'pensjon-alde',
    },
    previewDeployments: [
      {
        deploymentId: 1042,
        teamSlug: 'pensjondeployer',
        appName: 'pensjon-alde',
        environmentName: 'prod-gcp',
        createdAt: new Date('2026-10-13T12:00:00.000Z'),
        commitSha: 'a'.repeat(40),
        workflowRunId: '123456789',
        classification: 'eligible',
      },
      {
        deploymentId: 987,
        teamSlug: 'pensjon-saksbehandling',
        appName: 'pensjon-alde',
        environmentName: 'prod-gcp',
        createdAt: new Date('2026-10-12T12:00:00.000Z'),
        commitSha: 'b'.repeat(40),
        workflowRunId: null,
        classification: 'no_trigger_url',
      },
    ],
    invalidRepository: false,
    returnToTeam: 'pensjondeployer',
  },
}
