import type { Meta, StoryObj } from '@storybook/react'
import type { DeploymentDetailLoaderData } from '~/components/DeploymentDetailPage'
import type { DeploymentRepositoryDetails } from '~/components/DeploymentRepositoryPage'
import { DeploymentRepositoryPage } from '~/components/DeploymentRepositoryPage'
import type { DeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import { deploymentDetailsData } from './DeploymentDetail.stories'

const meta: Meta<typeof DeploymentRepositoryPage> = {
  title: 'Features/Deployments/Repositorybasert vurdering',
  component: DeploymentRepositoryPage,
  excludeStories: ['repositoryDeploymentData', 'repositoryDeploymentDetailsData'],
}
export default meta
type Story = StoryObj<typeof DeploymentRepositoryPage>

const sourcePrData = deploymentDetailsData.deployment.github_pr_data
if (!sourcePrData) throw new Error('Expected the deployment detail PR fixture')

const repositoryCommitShas = ['d'.repeat(40), 'c'.repeat(40)]
const repositoryPrData = {
  ...sourcePrData,
  title: 'feat: Repository delivery',
  base_branch: 'main',
  base_sha: 'a'.repeat(40),
  head_branch: 'feature/repository-delivery',
  head_sha: 'c'.repeat(40),
  merge_commit_sha: 'c'.repeat(40),
  commits_count: repositoryCommitShas.length,
  commits: repositoryCommitShas.map((sha, index) => {
    const author = index === 0 ? 'glad-fjord' : 'rask-elv'
    return {
      ...sourcePrData.commits[0],
      sha,
      message: index === 0 ? 'chore: update repository configuration' : 'feat: Repository delivery',
      html_url: `https://github.com/navikt/glad-fjord/commit/${sha}`,
      author: { username: author, login: author, avatar_url: sourcePrData.commits[0].author.avatar_url },
    }
  }),
  checks: sourcePrData.checks.map((check) => ({
    ...check,
    html_url: `https://github.com/navikt/glad-fjord/actions/runs/${check.id ?? 42}`,
  })),
}

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
        prReason: null,
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
    canAccessAdmin: false,
  },
}

export const repositoryDeploymentDetailsData: Pick<
  DeploymentRepositoryDetails,
  | 'deployment'
  | 'displayTitle'
  | 'previousDeploymentForDiff'
  | 'previousDeploymentForDiffLabel'
  | 'sameCommitMessage'
  | 'userMappings'
  | 'workflowTrigger'
> = {
  deployment: {
    created_at: repositoryDeploymentData.deployment.createdAt,
    deployer_username: 'glad-fjord',
    commit_sha: repositoryDeploymentData.deployment.commitSha,
    nais_deployment_id: 'nais-deployment-42',
    deployment_source: 'nais_deployment',
    deployment_source_id: 'nais-deployment-42',
    branch_name: repositoryDeploymentData.deployment.branchName,
    trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/123456789',
    parent_commits: null,
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'glad-fjord',
    github_pr_number: 42,
    github_pr_url: 'https://github.com/navikt/glad-fjord/pull/42',
    github_pr_data: repositoryPrData as NonNullable<DeploymentDetailLoaderData['deployment']['github_pr_data']>,
    commit_checks_data: deploymentDetailsData.deployment.commit_checks_data
      ? {
          ...deploymentDetailsData.deployment.commit_checks_data,
          checked_sha: repositoryDeploymentData.deployment.commitSha ?? '',
        }
      : null,
  },
  displayTitle: 'feat: Repository delivery',
  previousDeploymentForDiff: { commit_sha: 'b'.repeat(40) },
  previousDeploymentForDiffLabel: 'Endringer i repositoryleveransen',
  sameCommitMessage: 'Repositoryleveransen inneholder ingen endringer (samme commit).',
  userMappings: {
    'glad-fjord': { display_name: 'Glad Fjord' },
    'rask-elv': { display_name: 'Rask Elv' },
    'john-doe': { display_name: 'Tydelig Vik' },
    'jane-smith': { display_name: 'Trygg Li' },
    'bob-wilson': { display_name: 'Klok Skog' },
    'qa-reviewer': { display_name: 'Vaken Dal' },
    'ops-reviewer': { display_name: 'Stødig Varde' },
    'release-bot': { display_name: 'Release Bot' },
  },
  workflowTrigger: null,
}

export const Godkjent: Story = {
  args: { data: repositoryDeploymentData, deploymentDetails: repositoryDeploymentDetailsData },
}

export const ManglerLeveransekobling: Story = {
  args: {
    deploymentDetails: repositoryDeploymentDetailsData,
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
    deploymentDetails: repositoryDeploymentDetailsData,
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
    deploymentDetails: repositoryDeploymentDetailsData,
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
        canAccessAdmin: true,
      },
    },
  },
}

export const ManglerPrGrunnlag: Story = {
  args: {
    deploymentDetails: repositoryDeploymentDetailsData,
    data: {
      ...repositoryDeploymentData,
      link: {
        ...repositoryDeploymentData.link,
        state: 'linked',
        delivery: { id: 7, baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) },
        assessment: {
          status: 'incomplete',
          totalCommits: 1,
          listedCommits: 1,
          omittedCommits: 0,
          commits: [{ sha: 'c'.repeat(40), status: 'unknown', reason: 'unknown_pr_coverage' }],
        },
        commits: [
          {
            sha: 'c'.repeat(40),
            status: 'unknown',
            reason: 'unknown_pr_coverage',
            prReason: 'missing_pull_request_snapshot',
            authorLogin: 'rask-elv',
            pullRequestNumber: 123,
          },
        ],
        deployments: [],
        deploymentCount: 0,
        canApprove: false,
        canAccessAdmin: true,
      },
    },
  },
}
