import type { Meta, StoryObj } from '@storybook/react'
import { DeploymentRepositoryPage } from '~/components/DeploymentRepositoryPage'
import type { DeploymentRepositoryView } from '~/db/deployment-repository-view.server'

const meta: Meta<typeof DeploymentRepositoryPage> = {
  title: 'Features/Deployments/Repositorybasert vurdering',
  component: DeploymentRepositoryPage,
  excludeStories: ['repositoryDeploymentData'],
}
export default meta
type Story = StoryObj<typeof DeploymentRepositoryPage>

export const repositoryDeploymentData: DeploymentRepositoryView = {
  deployment: {
    id: 42,
    teamSlug: 'team-fjord',
    environmentName: 'prod-gcp',
    appName: 'glad-fjord-api',
    createdAt: new Date('2026-10-20T10:00:00Z'),
    commitSha: 'c'.repeat(40),
    branchName: 'main',
  },
  application: {
    status: 'unverified_commits',
    verificationRunAt: new Date('2026-10-20T10:01:00Z'),
    range: { baseSha: 'a'.repeat(40), headSha: 'c'.repeat(40) },
  },
  repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
  deployerUsername: 'glad-fjord',
  userMappings: { 'glad-fjord': { display_name: 'Glad Fjord' }, 'rask-elv': { display_name: 'Rask Elv' } },
  link: {
    state: 'linked',
    delivery: { id: 7, baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) },
    assessment: {
      status: 'approved',
      totalCommits: 1,
      listedCommits: 1,
      omittedCommits: 0,
      commits: [{ sha: 'c'.repeat(40), status: 'covered', reason: 'manual_approval' }],
    },
    commits: [
      {
        sha: 'c'.repeat(40),
        status: 'covered',
        reason: 'manual_approval',
        authorLogin: 'rask-elv',
        pullRequestNumber: null,
      },
    ],
    deployments: [
      {
        id: 42,
        teamSlug: 'team-fjord',
        environmentName: 'prod-gcp',
        appName: 'glad-fjord-api',
        createdAt: new Date('2026-10-20T10:00:00Z'),
      },
      {
        id: 43,
        teamSlug: 'team-fjord',
        environmentName: 'prod-gcp',
        appName: 'glad-fjord-web',
        createdAt: new Date('2026-10-20T11:00:00Z'),
      },
    ],
    deploymentCount: 2,
    canApprove: false,
  },
}

export const UlikeIntervaller: Story = { args: { data: repositoryDeploymentData } }

export const ManglerLeveransekobling: Story = {
  args: {
    data: {
      ...repositoryDeploymentData,
      link: {
        state: 'missing',
        reason: 'unresolved',
        unresolvedReason: 'ancestry_behind',
        candidate: null,
      },
    },
  },
}

export const MuligMatchUtenKobling: Story = {
  args: {
    data: {
      ...repositoryDeploymentData,
      link: {
        state: 'missing',
        reason: 'unlinked',
        unresolvedReason: null,
        candidate: { id: 7, baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) },
      },
    },
  },
}

export const UfullstendigGrunnlag: Story = {
  args: {
    data: {
      ...repositoryDeploymentData,
      link: {
        ...repositoryDeploymentData.link,
        state: 'linked',
        delivery: { id: 7, baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) },
        assessment: { status: 'incomplete', totalCommits: null, listedCommits: 0, omittedCommits: 0, commits: [] },
        commits: [],
        deployments: [],
        deploymentCount: 0,
        canApprove: false,
      },
    },
  },
}

export const ManglerAppvurdering: Story = {
  args: {
    data: {
      ...repositoryDeploymentData,
      application: { status: null, verificationRunAt: null, range: null },
    },
  },
}
