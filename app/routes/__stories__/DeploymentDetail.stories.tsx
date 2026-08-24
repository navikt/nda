import type { Meta, StoryObj } from '@storybook/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  type DeploymentDetailLoaderData,
  DeploymentDetailPage,
  type DeploymentDetailPageProps,
} from '~/components/DeploymentDetailPage'
import type { GitHubPRData } from '~/db/deployments.server'
import type { UserLookupMap } from '~/lib/user-display'

const userMappings: UserLookupMap = {
  'john-doe': { display_name: 'Glad Fjord', nav_ident: 'Z990001' },
  'jane-smith': { display_name: 'Rask Elv', nav_ident: 'Z990002' },
  'bob-wilson': { display_name: 'Klok Skog', nav_ident: 'Z990003' },
  'release-bot': { display_name: 'Release Bot', nav_ident: null },
  'ops-reviewer': { display_name: 'Stødig Varde', nav_ident: 'Z990004' },
  'qa-reviewer': { display_name: 'Vaken Dal', nav_ident: 'Z990005' },
}

const baseGithubPrData: GitHubPRData = {
  title: 'feat: Add new feature for pension calculation',
  body: '<p>Oppsummering av endringen.</p>',
  creator: { username: 'john-doe', avatar_url: 'https://example.com/john.png' },
  merger: { username: 'jane-smith', avatar_url: 'https://example.com/jane.png' },
  merged_by: { username: 'jane-smith', avatar_url: 'https://example.com/jane.png' },
  created_at: '2026-02-08T08:30:00Z',
  merged_at: '2026-02-08T10:00:00Z',
  base_branch: 'main',
  base_sha: 'fff1111111111111111111111111111111111111',
  head_branch: 'feature/new-pension-flow',
  head_sha: 'abc123def456789012345678901234567890abcd',
  merge_commit_sha: 'ddd3333333333333333333333333333333333333',
  draft: false,
  mergeable: true,
  mergeable_state: 'clean',
  rebaseable: true,
  locked: false,
  maintainer_can_modify: true,
  auto_merge: { enabled_by: 'jane-smith', merge_method: 'squash' },
  assignees: [{ username: 'qa-reviewer', avatar_url: 'https://example.com/qa.png' }],
  milestone: { title: 'Q1 mål', number: 1, state: 'open' },
  checks_passed: true,
  commits_count: 3,
  changed_files: 8,
  additions: 120,
  deletions: 14,
  comments_count: 2,
  review_comments_count: 1,
  labels: ['feature', 'pensjon'],
  reviewers: [
    {
      username: 'jane-smith',
      avatar_url: 'https://example.com/jane.png',
      state: 'APPROVED',
      submitted_at: '2026-02-08T09:45:00Z',
      commit_id: 'abc123def456789012345678901234567890abcd',
    },
    {
      username: 'bob-wilson',
      avatar_url: 'https://example.com/bob.png',
      state: 'APPROVED',
      submitted_at: '2026-02-08T09:50:00Z',
      commit_id: 'abc123def456789012345678901234567890abcd',
    },
  ],
  requested_reviewers: [{ username: 'ops-reviewer', avatar_url: 'https://example.com/ops.png' }],
  requested_teams: [{ name: 'Platform', slug: 'platform' }],
  commits: [
    {
      sha: 'abc123def456789012345678901234567890abcd',
      message: 'feat: Add new feature for pension calculation\n\nDetailed body',
      html_url: 'https://github.com/navikt/pensjon-pen/commit/abc123def456789012345678901234567890abcd',
      date: '2026-02-08T09:00:00Z',
      committer_date: '2026-02-08T09:00:00Z',
      parent_shas: ['fff1111111111111111111111111111111111111'],
      author: { username: 'john-doe', login: 'john-doe', avatar_url: 'https://example.com/john.png' },
    },
  ],
  comments: [
    {
      id: 9001,
      body: 'Ser bra ut',
      created_at: '2026-02-08T09:40:00Z',
      html_url: 'https://github.com/navikt/pensjon-pen/pull/42#issuecomment-1',
      user: { username: 'jane-smith', avatar_url: 'https://example.com/jane.png' },
    },
  ],
  unreviewed_commits: [],
  checks_ref: 'head' as const,
  checks: [
    {
      id: 777,
      name: 'CI / build',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-02-08T09:55:00Z',
      completed_at: '2026-02-08T09:56:10Z',
      html_url: 'https://github.com/navikt/pensjon-pen/runs/777',
    },
  ],
}

const baseDeployment: DeploymentDetailLoaderData['deployment'] = {
  id: 123,
  monitored_app_id: 99,
  team_slug: 'pensjondeployer',
  app_name: 'pensjon-pen',
  environment_name: 'prod-fss',
  created_at: new Date('2026-02-08T10:30:00Z'),
  deployer_username: 'john-doe',
  commit_sha: 'abc123def456789012345678901234567890abcd',
  nais_deployment_id: 'nais-depl-123',
  branch_name: 'main',
  default_branch: 'main',
  trigger_url: 'https://github.com/navikt/pensjon-pen/actions/runs/123456789',
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/42',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'pensjon-pen',
  four_eyes_status: 'approved',
  synced_at: new Date('2026-02-08T10:31:00Z'),
  title: 'feat: Add new feature for pension calculation',
  slack_message_ts: null,
  slack_channel_id: null,
  slack_deploy_message_ts: null,
  workflow_trigger_config: null,
  parent_commits: [
    { sha: 'fff1111111111111111111111111111111111111' },
    { sha: 'eee2222222222222222222222222222222222222' },
  ],
  resources: [
    { kind: 'Deployment', name: 'pensjon-pen' },
    { kind: 'HorizontalPodAutoscaler', name: 'pensjon-pen' },
  ],
  unverified_commits: [],
  commit_checks_data: {
    checked_sha: 'abc123def456789012345678901234567890abcd',
    checks_passed: true,
    checks: [
      {
        id: 777,
        name: 'CI / build',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-02-08T09:55:00Z',
        completed_at: '2026-02-08T09:56:10Z',
        html_url: 'https://github.com/navikt/pensjon-pen/runs/777',
        details_url: 'https://github.com/navikt/pensjon-pen/runs/777?check_suite_focus=true',
        app: { name: 'GitHub Actions', slug: 'github-actions' },
        output: { title: 'Build complete', summary: '', text: null, annotations_count: 0 },
        log_cached: false,
      },
    ],
  },
  github_pr_data: baseGithubPrData as NonNullable<DeploymentDetailLoaderData['deployment']['github_pr_data']>,
}

const baseLoaderData: DeploymentDetailLoaderData = {
  deployment: baseDeployment,
  deliveryCommits: [
    {
      sha: 'abc123def456789012345678901234567890abcd',
      message: 'feat: Add new feature for pension calculation',
      htmlUrl: 'https://github.com/navikt/pensjon-pen/commit/abc123def456789012345678901234567890abcd',
      authorUsername: 'john-doe',
      isBot: false,
      botDisplayName: null,
    },
    {
      sha: 'bbb123def456789012345678901234567890abcd',
      message: 'chore: update workflow metadata',
      htmlUrl: 'https://github.com/navikt/pensjon-pen/commit/bbb123def456789012345678901234567890abcd',
      authorUsername: 'release-bot',
      isBot: true,
      botDisplayName: 'Release Bot',
    },
  ],
  displayTitle: 'feat: Add new feature for pension calculation',
  comments: [
    {
      id: 1,
      deployment_id: 123,
      created_at: new Date('2026-02-08T11:00:00Z'),
      registered_by: 'jane-smith',
      comment_text: 'Review dokumentert i Slack.',
      slack_link: 'https://nav-no.slack.com/archives/C123/p123',
      comment_type: 'comment',
      approved_by: null,
      approved_at: null,
      deleted_at: null,
      deleted_by: null,
    },
  ],
  manualApproval: null,
  legacyInfo: null,
  statusHistory: [
    {
      id: 1,
      deployment_id: 123,
      change_source: 'verification',
      from_status: 'pending',
      to_status: 'approved',
      changed_by: 'jane-smith',
      created_at: new Date('2026-02-08T10:05:00Z'),
      details: null,
    },
  ],
  deviations: [],
  goalLinks: [
    {
      id: 1,
      deployment_id: 123,
      objective_id: 10,
      key_result_id: 11,
      external_url: null,
      external_url_title: null,
      comment: 'Koblet automatisk fra PR-tittel',
      link_method: 'pr_title',
      linked_by: 'john-doe',
      is_active: true,
      created_at: '2026-02-08T10:30:00Z',
      objective_title: 'Forbedre saksbehandleropplevelsen',
      key_result_title: 'Redusere feil i pensjonsberegning',
      board_period_label: 'Q1 2026',
      board_period_type: 'quarter',
      dev_team_slug: 'pensjon-oppfolging',
      section_slug: 'pensjon',
      objective_is_active: true,
      key_result_is_active: true,
    },
  ],
  availableBoards: [
    {
      id: 1,
      period_label: 'Q1 2026',
      dev_team_name: 'Pensjon Oppfølging',
      objectives: [
        {
          id: 10,
          title: 'Forbedre saksbehandleropplevelsen',
          key_results: [{ id: 11, title: 'Redusere feil i pensjonsberegning' }],
        },
      ],
    },
  ],
  sectionBoards: [],
  myDevTeams: [{ id: 1, name: 'Pensjon Oppfølging', slug: 'pensjon-oppfolging', sectionSlug: 'pensjon' }],
  goalLinkAppInfo: { appName: 'pensjon-pen', environmentName: 'prod-fss' },
  previousDeployment: {
    ...baseDeployment,
    id: 122,
    commit_sha: '9999999999999999999999999999999999999999',
    created_at: new Date('2026-02-08T08:00:00Z'),
    four_eyes_status: 'approved',
    github_pr_number: null,
    github_pr_url: null,
    github_pr_data: null,
    commit_checks_data: null,
  },
  previousDeploymentForDiff: {
    commit_sha: '9999999999999999999999999999999999999999',
  },
  nextDeployment: {
    ...baseDeployment,
    id: 124,
  },
  userMappings,
  appUrl: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen',
  isCurrentUserInvolved: false,
  currentUserNavIdent: 'Z990001',
  involvementReason: null,
  isDebugMode: false,
  isAdmin: false,
  capabilities: {
    canVerify: true,
    canApprove: true,
    canNotify: true,
    canLinkGoal: true,
    canDeviate: true,
    canLookupLegacy: true,
    canResetVerification: true,
    canMoveBaseline: false,
  },
  baselineMove: null,
  verificationRun: {
    id: 1,
    status: 'completed',
    runAt: new Date('2026-02-08T10:05:00Z'),
    schemaVersion: 5,
    prSnapshotIds: [],
    commitSnapshotIds: [],
    result: undefined,
  },
  nearbyDeployments: [
    {
      id: 121,
      commit_sha: '9999999999999999999999999999999999999999',
      created_at: '2026-02-08T07:50:00Z',
      four_eyes_status: 'approved',
      deployer_username: 'jane-smith',
      title: 'Tidligere godkjent deploy',
    },
  ],
  slackConfig: {
    enabled: true,
    channelId: 'C123456',
    alreadySent: false,
  },
  registeredRepos: [{ owner: 'navikt', name: 'pensjon-pen' }],
  managingTeams: [{ slug: 'pensjon-oppfolging', name: 'Pensjon Oppfølging', sectionSlug: 'pensjon' }],
  workflowTrigger: {
    workflowPath: '.github/workflows/deploy.yml',
    triggerEvent: 'workflow_dispatch',
    checkSuiteId: 123,
    schemaVersion: 1,
  },
}

const meta: Meta<typeof DeploymentDetailPage> = {
  title: 'Pages/DeploymentDetail',
  component: DeploymentDetailPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    router: { skip: true },
  },
}

export default meta

type Story = StoryObj<typeof meta>

type StoryProps = Partial<DeploymentDetailPageProps> & {
  loaderData?: Partial<DeploymentDetailLoaderData>
  initialEntry?: string
}

function mergeDeployment(overrides?: Partial<DeploymentDetailLoaderData['deployment']>) {
  return {
    ...baseLoaderData.deployment,
    ...overrides,
    github_pr_data:
      overrides && 'github_pr_data' in overrides
        ? (overrides.github_pr_data ?? null)
        : baseLoaderData.deployment.github_pr_data,
    commit_checks_data:
      overrides && 'commit_checks_data' in overrides
        ? (overrides.commit_checks_data ?? null)
        : baseLoaderData.deployment.commit_checks_data,
  }
}

function renderDeploymentDetailStory({
  loaderData,
  actionData = null,
  initialEntry = '/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments/123?period=last-week',
}: StoryProps) {
  const mergedLoaderData: DeploymentDetailLoaderData = {
    ...baseLoaderData,
    ...loaderData,
    deployment: mergeDeployment(loaderData?.deployment),
  }

  const router = createMemoryRouter(
    [
      {
        path: '/team/:team/env/:env/app/:app/deployments/:id',
        element: <DeploymentDetailPage loaderData={mergedLoaderData} actionData={actionData} />,
      },
    ],
    { initialEntries: [initialEntry] },
  )

  return <RouterProvider router={router} />
}

export const Approved: Story = {
  name: 'Godkjent',
  args: {
    loaderData: baseLoaderData,
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const NotApproved: Story = {
  name: 'Ikke godkjent',
  args: {
    loaderData: {
      ...baseLoaderData,
      isAdmin: true,
      deployment: {
        ...baseLoaderData.deployment,
        four_eyes_status: 'unverified_commits',
        unverified_commits: [
          {
            sha: '4444444444444444444444444444444444444444',
            html_url: 'https://github.com/navikt/pensjon-pen/commit/4444444444444444444444444444444444444444',
            message: 'fix: rett edge case i beregning',
            author: 'john-doe',
            date: '2026-02-08T09:58:00Z',
            reason: 'no_approved_reviews',
            pr_number: 43,
          },
        ],
      },
      slackConfig: { enabled: true, channelId: 'C123456', alreadySent: false },
      verificationRun: {
        ...(baseLoaderData.verificationRun ?? {
          id: 1,
          status: 'completed',
          runAt: new Date('2026-02-08T10:05:00Z'),
          schemaVersion: 5,
          prSnapshotIds: [],
          commitSnapshotIds: [],
          result: undefined,
        }),
      },
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const Pending: Story = {
  name: 'Venter verifisering',
  args: {
    loaderData: {
      ...baseLoaderData,
      deployment: {
        ...baseLoaderData.deployment,
        four_eyes_status: 'pending',
      },
      statusHistory: [],
      slackConfig: { enabled: true, channelId: 'C123456', alreadySent: true },
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const DirectPush: Story = {
  name: 'Direct Push (ingen PR)',
  args: {
    loaderData: {
      ...baseLoaderData,
      isAdmin: true,
      deployment: {
        ...baseLoaderData.deployment,
        four_eyes_status: 'direct_push',
        github_pr_number: null,
        github_pr_url: null,
        github_pr_data: null,
        commit_checks_data: null,
      },
      displayTitle: null,
      deliveryCommits: baseLoaderData.deliveryCommits ? [baseLoaderData.deliveryCommits[0]] : null,
      comments: [],
      goalLinks: [],
      statusHistory: [],
      previousDeploymentForDiff: {
        commit_sha: '9999999999999999999999999999999999999999',
      },
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const ManuallyApproved: Story = {
  name: 'Manuelt godkjent',
  args: {
    loaderData: {
      ...baseLoaderData,
      deployment: {
        ...baseLoaderData.deployment,
        four_eyes_status: 'manually_approved',
      },
      manualApproval: {
        id: 5,
        deployment_id: 123,
        comment_text: 'Gjennomgått i Slack med Rask Elv.',
        slack_link: 'https://nav-no.slack.com/archives/C123/p456',
        comment_type: 'manual_approval',
        approved_by: 'bob-wilson',
        approved_at: new Date('2026-02-08T10:20:00Z'),
        registered_by: 'bob-wilson',
        created_at: new Date('2026-02-08T10:20:00Z'),
        deleted_at: null,
        deleted_by: null,
      },
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const PendingBaseline: Story = {
  name: 'Baseline: venter godkjenning (pending_baseline)',
  args: {
    loaderData: {
      ...baseLoaderData,
      deployment: {
        ...baseLoaderData.deployment,
        id: 16833,
        four_eyes_status: 'pending_baseline',
        github_pr_number: null,
        github_pr_url: null,
        github_pr_data: null,
      },
      previousDeployment: null,
      previousDeploymentForDiff: null,
      nextDeployment: { ...baseLoaderData.deployment, id: 16834 },
      statusHistory: [],
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const BaselineMissingApprover: Story = {
  name: 'Baseline: godkjent uten kjent godkjenner (trenger re-approve)',
  args: {
    loaderData: {
      ...baseLoaderData,
      deployment: {
        ...baseLoaderData.deployment,
        id: 16833,
        four_eyes_status: 'baseline',
        github_pr_number: null,
        github_pr_url: null,
        github_pr_data: null,
      },
      statusHistory: [
        {
          id: 2,
          deployment_id: 16833,
          change_source: 'verification',
          from_status: 'pending_baseline',
          to_status: 'baseline',
          changed_by: null,
          created_at: new Date('2026-02-08T10:05:00Z'),
          details: null,
        },
      ],
      previousDeployment: null,
      previousDeploymentForDiff: null,
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const BaselineApprovedWithApprover: Story = {
  name: 'Baseline: godkjent med kjent godkjenner (ingen handling nødvendig)',
  args: {
    loaderData: {
      ...baseLoaderData,
      deployment: {
        ...baseLoaderData.deployment,
        id: 16833,
        four_eyes_status: 'baseline',
        github_pr_number: null,
        github_pr_url: null,
        github_pr_data: null,
      },
      statusHistory: [
        {
          id: 3,
          deployment_id: 16833,
          change_source: 'baseline_approval',
          from_status: 'pending_baseline',
          to_status: 'baseline',
          changed_by: 'jane-smith',
          created_at: new Date('2026-02-08T10:05:00Z'),
          details: null,
        },
      ],
      previousDeployment: null,
      previousDeploymentForDiff: null,
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}

export const MoveBaseline: Story = {
  name: 'Baseline: kan flyttes hit (tech lead)',
  args: {
    loaderData: {
      ...baseLoaderData,
      deployment: {
        ...baseLoaderData.deployment,
        id: 16820,
        four_eyes_status: 'unverified_commits',
      },
      capabilities: {
        ...baseLoaderData.capabilities,
        canMoveBaseline: true,
      },
      baselineMove: {
        eligible: true,
        anchors: [{ id: 16833, created_at: '2026-02-10T09:00:00+00:00', four_eyes_status: 'pending_baseline' }],
      },
      statusHistory: [],
    },
  },
  render: (args) => renderDeploymentDetailStory(args),
}
