import {
  ArrowsCirclepathIcon,
  ChatIcon,
  CheckmarkCircleIcon,
  CheckmarkIcon,
  ExclamationmarkTriangleIcon,
} from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import { useRef } from 'react'
import { Form, Link, useNavigation, useSearchParams } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { BaselineInfo } from '~/components/BaselineInfo'
import { ExternalLink } from '~/components/ExternalLink'
import {
  type AvailableBoard,
  type GoalLinkAppInfo,
  GoalLinksSection,
  type MyDevTeamForGoalLinking,
} from '~/components/GoalLinksSection'
import { UserName } from '~/components/UserName'
import { type FourEyesStatus, isApprovedStatus, isProtectedStatus } from '~/lib/four-eyes-status'
import { getFourEyesStatus } from '~/lib/status-display'
import type { UserLookupMap } from '~/lib/user-display'
import { UNVERIFIED_REASON_LABELS, type UnverifiedReason } from '~/lib/verification/types'
import { CommentModal } from '~/routes/deployments/$id/CommentModal'
import { CommentsSection } from '~/routes/deployments/$id/CommentsSection'
import { DeliveryCommitsSection } from '~/routes/deployments/$id/DeliveryCommitsSection'
import { DeploymentDetailsGrid } from '~/routes/deployments/$id/DeploymentDetailsGrid'
import { DeviationModal } from '~/routes/deployments/$id/DeviationModal'
import { DeviationsSection } from '~/routes/deployments/$id/DeviationsSection'
import { FourEyesAlert } from '~/routes/deployments/$id/FourEyesAlert'
import { LegacyLookupSection } from '~/routes/deployments/$id/LegacyLookupSection'
import { LegacyPendingApproval } from '~/routes/deployments/$id/LegacyPendingApproval'
import { ManualApprovalSection } from '~/routes/deployments/$id/ManualApprovalSection'
import { PrDetailsAccordion } from '~/routes/deployments/$id/PrDetailsAccordion'
import { ResetVerificationModal } from '~/routes/deployments/$id/ResetVerificationModal'
import { StatusHistorySection } from '~/routes/deployments/$id/StatusHistorySection'

export type DeploymentDetailPageProps = {
  loaderData: DeploymentDetailLoaderData
  actionData?: Record<string, unknown> | null
}

type GitHubUser = { username: string; avatar_url?: string }
type Reviewer = { username: string; state: string; submitted_at: string }
type RequestedTeam = { name: string; slug: string }
type PrCommit = { sha: string; message: string; html_url: string; date: string; author?: GitHubUser }
type PrComment = { id: number; body: string; created_at: string; html_url: string; user?: GitHubUser }
type UnreviewedCommit = { sha: string; html_url: string; author: string; date: string; message: string; reason: string }
type UnverifiedCommit = {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string
}
type CheckRun = {
  id?: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  html_url?: string | null
  details_url?: string | null
  app?: { name: string; slug: string | null } | null
  output?: { title: string | null; summary: string | null; annotations_count: number } | null
  log_cached?: boolean
  annotations?: unknown[] | null
}
type GithubPrData = {
  title: string
  body: string | null
  creator?: GitHubUser
  merger?: GitHubUser | null
  created_at: string
  merged_at: string | null
  base_branch: string
  head_branch?: string | null
  merge_commit_sha?: string | null
  draft?: boolean
  locked?: boolean
  auto_merge?: { merge_method: string } | null
  assignees?: GitHubUser[]
  requested_reviewers?: GitHubUser[]
  requested_teams?: RequestedTeam[]
  milestone?: { title: string; state: string } | null
  checks_passed?: boolean | null
  commits_count: number
  changed_files: number
  additions: number
  deletions: number
  comments_count?: number
  review_comments_count?: number
  labels: string[]
  reviewers: Reviewer[]
  commits: PrCommit[]
  comments: PrComment[]
  checks?: CheckRun[] | null
  checks_ref?: string | null
  unreviewed_commits?: UnreviewedCommit[]
}
type DeploymentResource = { kind: string; name: string }
type DeploymentParentCommit = { sha: string }
type DeploymentRecord = {
  id: number
  monitored_app_id: number
  team_slug: string
  app_name: string
  environment_name: string
  title?: string | null
  created_at: string | Date
  synced_at?: string | Date | null
  deployer_username: string | null
  commit_sha: string | null
  nais_deployment_id: string
  branch_name?: string | null
  default_branch: string | null
  trigger_url?: string | null
  github_pr_number: number | null
  github_pr_url: string | null
  detected_github_owner: string
  detected_github_repo_name: string
  four_eyes_status: string
  has_goal_link?: boolean
  slack_message_ts?: string | null
  parent_commits?: DeploymentParentCommit[] | null
  resources?: DeploymentResource[] | null
  unverified_commits?: UnverifiedCommit[] | null
  commit_checks_data?: { checks_passed: boolean | null; checks: CheckRun[] } | null
  github_pr_data: GithubPrData | null
  workflow_trigger_config?: WorkflowTriggerConfig | null
}
type DeliveryCommit = {
  sha: string
  message: string
  authorUsername: string
  htmlUrl: string
  isBot: boolean
  botDisplayName: string | null
}
type DeploymentComment = {
  id: number
  created_at: string | Date
  registered_by: string | null
  comment_text: string
  slack_link: string | null
}
type ManualApproval = {
  approved_by: string | null
  approved_at: string | Date | null
  comment_text: string | null
  slack_link: string | null
}
type LegacyInfo = {
  registered_by: string | null
  created_at: string | Date | null
  comment_text: string | null
  slack_link: string | null
} | null
type StatusHistoryEntry = {
  id: number
  change_source: string
  from_status: string | null
  to_status: string
  changed_by: string | null
  created_at: string | Date
  details: Record<string, unknown> | null
}
type Deviation = {
  id: number
  created_at: string | Date
  registered_by: string | null
  registered_by_name?: string | null
  resolved_at?: string | Date | null
  resolved_by?: string | null
  resolved_by_name?: string | null
  resolution_note?: string | null
  severity?: 'low' | 'medium' | 'high' | 'critical' | null
  intent?: 'accidental' | 'unknown' | 'malicious' | null
  follow_up_role?: 'product_lead' | 'delivery_lead' | 'section_lead' | null
  breach_type?: string | null
  reason: string
}
type GoalLink = Parameters<typeof GoalLinksSection>[0]['goalLinks'][number]
type PreviousDeployment = {
  id: number
  commit_sha: string | null
  created_at: string | Date
  four_eyes_status: string
} | null
type PreviousDeploymentForDiff = { commit_sha: string | null } | null
type NextDeployment = { id: number } | null
type DeploymentCapabilities = {
  canApprove: boolean
  canVerify: boolean
  canDeviate: boolean
  canLinkGoal: boolean
  canNotify: boolean
  canLookupLegacy: boolean
  canResetVerification: boolean
}
type VerificationRun = {
  status: string
  runAt: string | Date
  schemaVersion: number
  result?: Record<string, unknown>
} | null
type NearbyDeployment = {
  id: number
  commit_sha: string
  created_at: string
  four_eyes_status: string
  deployer_username: string | null
  title: string | null
}
type SlackConfig = { enabled: boolean; channelId: string | null; alreadySent: boolean } | null
type RegisteredRepo = { owner: string; name: string }
type ManagingTeam = { name: string; slug: string; sectionSlug: string | null }
type WorkflowTriggerConfig = {
  workflowPath: string
  triggerEvent: string
  checkSuiteId: number | null
  schemaVersion?: number
} | null

export interface DeploymentDetailLoaderData {
  deployment: DeploymentRecord
  deliveryCommits: DeliveryCommit[] | null
  displayTitle: string | null
  comments: DeploymentComment[]
  manualApproval: ManualApproval | null
  legacyInfo: LegacyInfo
  statusHistory: StatusHistoryEntry[]
  deviations: Deviation[]
  goalLinks: GoalLink[]
  availableBoards: AvailableBoard[]
  sectionBoards: AvailableBoard[]
  myDevTeams: MyDevTeamForGoalLinking[]
  goalLinkAppInfo?: GoalLinkAppInfo
  previousDeployment: PreviousDeployment
  previousDeploymentForDiff: PreviousDeploymentForDiff
  nextDeployment: NextDeployment
  userMappings: UserLookupMap
  appUrl: string
  currentUserNavIdent?: string | null
  isCurrentUserInvolved: boolean
  involvementReason: string | null
  isDebugMode: boolean
  isAdmin: boolean
  capabilities: DeploymentCapabilities
  verificationRun: VerificationRun
  nearbyDeployments: NearbyDeployment[]
  slackConfig: SlackConfig
  registeredRepos: RegisteredRepo[]
  managingTeams: ManagingTeam[]
  workflowTrigger: WorkflowTriggerConfig
}

export function DeploymentDetailPage({ loaderData, actionData }: DeploymentDetailPageProps) {
  const {
    deployment,
    deliveryCommits,
    displayTitle,
    comments,
    manualApproval,
    legacyInfo,
    statusHistory,
    deviations,
    goalLinks,
    availableBoards,
    sectionBoards,
    myDevTeams,
    goalLinkAppInfo,
    previousDeployment,
    previousDeploymentForDiff,
    nextDeployment,
    userMappings,
    appUrl,
    isCurrentUserInvolved,
    involvementReason,
    isDebugMode,
    isAdmin,
    capabilities,
    verificationRun,
    nearbyDeployments,
    slackConfig,
    registeredRepos,
    managingTeams,
    workflowTrigger,
  } = loaderData
  const [searchParams] = useSearchParams()
  const navigation = useNavigation()
  const isVerifying = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'verify_four_eyes'
  const statusesRequiringApproval = [
    'direct_push',
    'missing',
    'unverified_commits',
    'approved_pr_with_unreviewed',
    'error',
    'pr_not_approved',
  ]
  const isLegacy = deployment.four_eyes_status === 'legacy'
  const isLegacyPending = deployment.four_eyes_status === 'legacy_pending'
  const isPendingApproval = deployment.four_eyes_status === 'pending_approval' || isLegacyPending
  const requiresManualApproval =
    statusesRequiringApproval.includes(deployment.four_eyes_status ?? '') && !manualApproval
  const commentDialogRef = useRef<HTMLDialogElement>(null)
  const deviationDialogRef = useRef<HTMLDialogElement>(null)
  const resetVerificationDialogRef = useRef<HTMLDialogElement>(null)
  const status = getFourEyesStatus(deployment)

  return (
    <VStack gap="space-32">
      <HStack justify="space-between" gap="space-8">
        <div>
          {(isDebugMode || isAdmin) && (
            <HStack gap="space-2">
              {isDebugMode && (
                <Button
                  as={Link}
                  to={`${appUrl}/deployments/${deployment.id}/debug-verify`}
                  variant="tertiary"
                  size="xsmall"
                >
                  🔬 Debug verifisering
                </Button>
              )}
              {isAdmin && (
                <Button
                  as={Link}
                  to={`${appUrl}/deployments/${deployment.id}/debug-keywords`}
                  variant="tertiary"
                  size="xsmall"
                >
                  🔑 Debug nøkkelord
                </Button>
              )}
              {capabilities.canResetVerification && isProtectedStatus(deployment.four_eyes_status ?? '') && (
                <Button
                  variant="tertiary"
                  size="xsmall"
                  onClick={() => resetVerificationDialogRef.current?.showModal()}
                >
                  🔄 Tilbakestill verifisering
                </Button>
              )}
            </HStack>
          )}
        </div>
        <HStack gap="space-8">
          {previousDeployment ? (
            <Button
              as={Link}
              to={`${appUrl}/deployments/${previousDeployment.id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
              variant="tertiary"
              size="xsmall"
            >
              ← Forrige
            </Button>
          ) : (
            <Button variant="tertiary" size="xsmall" disabled>
              ← Forrige
            </Button>
          )}
          <Button
            as={Link}
            to={`${appUrl}/deployments${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
            variant="tertiary"
            size="xsmall"
          >
            Alle
          </Button>
          {nextDeployment ? (
            <Button
              as={Link}
              to={`${appUrl}/deployments/${nextDeployment.id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
              variant="tertiary"
              size="xsmall"
            >
              Neste →
            </Button>
          ) : (
            <Button variant="tertiary" size="xsmall" disabled>
              Neste →
            </Button>
          )}
        </HStack>
      </HStack>
      <div>
        <HStack align="center" gap="space-12" wrap>
          <Heading size="large" level="1" style={{ flex: 1 }}>
            {displayTitle ||
              deployment.github_pr_data?.title ||
              `${deployment.app_name} @ ${deployment.environment_name}`}
          </Heading>
          <HStack gap="space-8" align="center">
            {isApprovedStatus((deployment.four_eyes_status ?? '') as FourEyesStatus) && (
              <Tag data-color="success" variant="outline" size="small">
                {deployment.four_eyes_status === 'implicitly_approved' ? 'Implisitt godkjent' : 'Godkjent'}
              </Tag>
            )}
            {deployment.github_pr_number ? (
              <Tag data-color="info" variant="outline" size="small">
                Pull Request
              </Tag>
            ) : deployment.four_eyes_status === 'direct_push' ||
              deployment.four_eyes_status === 'unverified_commits' ? (
              <Tag data-color="warning" variant="outline" size="small">
                Direct Push
              </Tag>
            ) : deployment.four_eyes_status === 'legacy' ? (
              <Tag data-color="neutral" variant="outline" size="small">
                Legacy
              </Tag>
            ) : null}
            {deliveryCommits && deliveryCommits.length > 1 && (
              <>
                <Tag data-color="neutral" variant="outline" size="small">
                  {deliveryCommits.length} commits
                </Tag>
                {(() => {
                  const botCount = deliveryCommits.filter((c) => c.isBot).length
                  const humanCount = deliveryCommits.length - botCount
                  if (botCount === 0 || humanCount === 0) return null
                  return (
                    <>
                      <Tag data-color="neutral" variant="outline" size="small">
                        🤖 {botCount}
                      </Tag>
                      <Tag data-color="neutral" variant="outline" size="small">
                        👤 {humanCount}
                      </Tag>
                    </>
                  )
                })()}
              </>
            )}
            {capabilities.canVerify &&
              deployment.commit_sha &&
              [
                'error',
                'missing',
                'direct_push',
                'unverified_commits',
                'pr_not_approved',
                'approved_pr_with_unreviewed',
                'baseline',
                'no_changes',
                'pending_baseline',
                'unauthorized_branch',
                'unauthorized_repository',
              ].includes(deployment.four_eyes_status) && (
                <Form method="post" style={{ display: 'inline' }}>
                  <input type="hidden" name="intent" value="verify_four_eyes" />
                  <Button
                    type="submit"
                    size="small"
                    variant="tertiary"
                    icon={<ArrowsCirclepathIcon aria-hidden />}
                    title="Verifiser godkjenningsstatus mot GitHub"
                    loading={isVerifying}
                  >
                    Verifiser
                  </Button>
                </Form>
              )}
            {capabilities.canApprove &&
              (deployment.four_eyes_status === 'pending_baseline' ||
                (deployment.four_eyes_status === 'baseline' &&
                  !statusHistory.some((h) => h.change_source === 'baseline_approval' && h.changed_by !== null))) && (
                <Form method="post" style={{ display: 'inline' }}>
                  <input type="hidden" name="intent" value="approve_baseline" />
                  <Button
                    type="submit"
                    size="small"
                    variant="primary"
                    icon={<CheckmarkCircleIcon aria-hidden />}
                    title="Godkjenn dette deploymentet som baseline"
                  >
                    Godkjenn baseline
                  </Button>
                </Form>
              )}
          </HStack>
        </HStack>
        <BodyShort textColor="subtle">
          {new Date(deployment.created_at).toLocaleString('no-NO', { dateStyle: 'long', timeStyle: 'short' })}
          {deployment.github_pr_number && deployment.github_pr_url && (
            <>
              {' '}
              via <ExternalLink href={deployment.github_pr_url}>#{deployment.github_pr_number}</ExternalLink>
            </>
          )}
        </BodyShort>
      </div>
      <DeliveryCommitsSection deliveryCommits={deliveryCommits} userMappings={userMappings} />
      <ActionAlert data={actionData} />
      {deployment.four_eyes_status === 'baseline' &&
        !statusHistory.some((h) => h.change_source === 'baseline_approval' && h.changed_by !== null) && (
          <Alert variant="warning">
            <Heading size="small" level="3" spacing>
              Godkjenner ikke registrert
            </Heading>
            <VStack gap="space-8">
              <BodyShort>
                Baseline ble godkjent uten at godkjenneren ble registrert. Godkjenn baseline på nytt for å dokumentere
                hvem som bekrefter at koden var godkjent.
              </BodyShort>
              <BaselineInfo />
            </VStack>
          </Alert>
        )}
      {(() => {
        const branchMismatch = (
          verificationRun?.result as
            | { branchMismatch?: { expectedBranch: string; detectedBranches: string[]; prNumbers: number[] } }
            | undefined
        )?.branchMismatch
        if (!branchMismatch) return null
        return (
          <Alert variant="warning">
            <Heading size="small" level="3" spacing>
              Mulig feil-konfigurert default-branch
            </Heading>
            <BodyShort>
              Appen er konfigurert med <code>{branchMismatch.expectedBranch}</code> som default-branch, men PR
              {branchMismatch.prNumbers.length > 1 ? '-er' : ''}{' '}
              {branchMismatch.prNumbers.map((n, idx) => (
                <span key={n}>
                  {idx > 0 ? ', ' : ''}
                  {deployment.detected_github_owner && deployment.detected_github_repo_name ? (
                    <ExternalLink
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/pull/${n}`}
                    >
                      #{n}
                    </ExternalLink>
                  ) : (
                    `#${n}`
                  )}
                </span>
              ))}{' '}
              er merget mot <code>{branchMismatch.detectedBranches.join(', ')}</code>. Dette gjør at PR-data ignoreres
              ved verifisering. Konfigurasjonen rettes automatisk innen 24 timer, og deretter må deploymentet
              re-verifiseres.
            </BodyShort>
          </Alert>
        )
      })()}
      {!isApprovedStatus((deployment.four_eyes_status ?? '') as FourEyesStatus) && (
        <FourEyesAlert
          status={status}
          deployment={deployment as never}
          previousDeploymentForDiff={previousDeploymentForDiff as never}
          registeredRepos={registeredRepos as never}
          managingTeams={managingTeams as never}
          appUrl={appUrl as never}
          capabilities={capabilities as never}
          isVerifying={isVerifying}
          isAdmin={isAdmin as never}
          verificationRun={verificationRun as never}
          nearbyDeployments={nearbyDeployments as never}
          userMappings={userMappings as never}
        />
      )}
      {!isApprovedStatus((deployment.four_eyes_status ?? '') as FourEyesStatus) &&
        (() => {
          const prCommitShas = new Set(deployment.github_pr_data?.commits?.map((c) => c.sha) || [])
          const mergeCommitSha = deployment.github_pr_data?.merge_commit_sha
          const filteredUnverifiedCommits =
            deployment.unverified_commits?.filter(
              (commit) => !prCommitShas.has(commit.sha) && commit.sha !== mergeCommitSha,
            ) || []
          return filteredUnverifiedCommits.length > 0 ? (
            <Alert variant="error">
              <Heading size="small" level="3" spacing>
                Ikke-godkjente commits ({filteredUnverifiedCommits.length})
              </Heading>
              <BodyShort spacing>
                Følgende commits mangler godkjenning etter fire-øyne-prinsippet.
                {previousDeploymentForDiff?.commit_sha && deployment.commit_sha && (
                  <>
                    {' '}
                    <ExternalLink
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeploymentForDiff.commit_sha}...${deployment.commit_sha}`}
                    >
                      Se endringer på GitHub
                    </ExternalLink>
                  </>
                )}
              </BodyShort>
              <ul style={{ margin: 0, paddingLeft: 'var(--ax-space-24)' }}>
                {filteredUnverifiedCommits.map((commit) => (
                  <li key={commit.sha} style={{ marginBottom: 'var(--ax-space-8)' }}>
                    <ExternalLink href={commit.html_url} style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {commit.sha.substring(0, 7)}
                    </ExternalLink>{' '}
                    - {commit.message}
                    <br />
                    <Detail>
                      av <UserName username={commit.author} userMappings={userMappings} link={false} /> •{' '}
                      {commit.reason && commit.reason in UNVERIFIED_REASON_LABELS
                        ? UNVERIFIED_REASON_LABELS[commit.reason as UnverifiedReason]
                        : commit.pr_number
                          ? `PR #${commit.pr_number} ikke godkjent`
                          : 'Ingen PR (direkte push)'}
                      {commit.pr_number && deployment.detected_github_owner && deployment.detected_github_repo_name && (
                        <>
                          {' '}
                          (
                          <ExternalLink
                            href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/pull/${commit.pr_number}`}
                          >
                            #{commit.pr_number}
                          </ExternalLink>
                          )
                        </>
                      )}
                    </Detail>
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null
        })()}
      <DeploymentDetailsGrid
        deployment={deployment as never}
        userMappings={userMappings as never}
        previousDeploymentForDiff={previousDeploymentForDiff as never}
        workflowTrigger={workflowTrigger as never}
      />
      {deployment.github_pr_data?.reviewers?.some((r) => r.state === 'APPROVED') && (
        <VStack gap="space-4">
          <Detail>Godkjent av</Detail>
          <HStack gap="space-8" wrap>
            {deployment.github_pr_data.reviewers
              .filter((r) => r.state === 'APPROVED')
              .map((reviewer) => (
                <Tag
                  key={`${reviewer.username}:${reviewer.submitted_at}`}
                  data-color="success"
                  variant="moderate"
                  size="small"
                  icon={<CheckmarkIcon aria-hidden />}
                >
                  <ExternalLink href={`https://github.com/${reviewer.username}`}>
                    <UserName username={reviewer.username} userMappings={userMappings} link={false} />
                  </ExternalLink>
                </Tag>
              ))}
          </HStack>
        </VStack>
      )}
      {(deployment.github_pr_data || deployment.commit_checks_data) && (
        <PrDetailsAccordion
          deployment={deployment as never}
          githubPrData={deployment.github_pr_data as never}
          commitChecksData={deployment.commit_checks_data as never}
          userMappings={userMappings as never}
        />
      )}
      {deployment.resources && deployment.resources.length > 0 && (
        <div>
          <Heading size="small" level="3" spacing>
            Kubernetes Resources
          </Heading>
          <HStack gap="space-8" wrap>
            {deployment.resources.map((resource) => (
              <Tag data-color="info" key={`${resource.kind}:${resource.name}`} variant="outline" size="small">
                {resource.kind}: {resource.name}
              </Tag>
            ))}
          </HStack>
        </div>
      )}
      {deployment.github_pr_data && (
        <VStack gap="space-16">
          {deployment.github_pr_data.body && (
            <div>
              <Heading size="medium" level="2">
                Beskrivelse
              </Heading>
              <Box background="neutral-soft" padding="space-16" borderRadius="12" marginBlock="space-8 space-0">
                <BodyShort style={{ whiteSpace: 'pre-wrap' }}>
                  {/* biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub PR body contains safe markdown HTML */}
                  <div dangerouslySetInnerHTML={{ __html: deployment.github_pr_data.body }} />
                </BodyShort>
              </Box>
            </div>
          )}
          <HGrid gap="space-16" columns={{ xs: 2, sm: 3, md: 6 }}>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Commits</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.commits_count}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Filer endret</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.changed_files}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Linjer lagt til</Detail>
                <BodyShort style={{ color: 'var(--ax-text-success)' }}>
                  <strong>+{deployment.github_pr_data.additions}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Linjer fjernet</Detail>
                <BodyShort style={{ color: 'var(--ax-text-danger)' }}>
                  <strong>-{deployment.github_pr_data.deletions}</strong>
                </BodyShort>
              </VStack>
            </Box>
            {deployment.github_pr_data.comments_count !== undefined && (
              <Box padding="space-12" borderRadius="8" background="sunken">
                <VStack gap="space-4">
                  <Detail textColor="subtle">Kommentarer</Detail>
                  <BodyShort>
                    <strong>{deployment.github_pr_data.comments_count}</strong>
                  </BodyShort>
                </VStack>
              </Box>
            )}
            {deployment.github_pr_data.review_comments_count !== undefined && (
              <Box padding="space-12" borderRadius="8" background="sunken">
                <VStack gap="space-4">
                  <Detail textColor="subtle">Review-kommentarer</Detail>
                  <BodyShort>
                    <strong>{deployment.github_pr_data.review_comments_count}</strong>
                  </BodyShort>
                </VStack>
              </Box>
            )}
          </HGrid>
          {deployment.github_pr_data.labels && deployment.github_pr_data.labels.length > 0 && (
            <VStack gap="space-8">
              <Detail textColor="subtle">Labels</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.labels.map((label) => (
                  <Tag data-color="neutral" key={label} variant="outline" size="small">
                    {label}
                  </Tag>
                ))}
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
      {deployment.github_pr_data?.unreviewed_commits && deployment.github_pr_data.unreviewed_commits.length > 0 && (
        <div>
          <Alert variant="error">
            <Heading size="small" level="3" spacing>
              <ExclamationmarkTriangleIcon aria-hidden /> Ureviewed commits funnet
            </Heading>
            <BodyShort spacing>
              Følgende commits var på main mellom PR base og merge, men mangler godkjenning:
            </BodyShort>
          </Alert>
          <VStack gap="space-8">
            {deployment.github_pr_data.unreviewed_commits.map((commit) => (
              <Box
                key={commit.sha}
                background="danger-soft"
                padding="space-16"
                borderRadius="8"
                borderWidth="1"
                borderColor="danger-subtleA"
              >
                <HStack gap="space-12">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <HStack gap="space-8" align="baseline" wrap>
                      <ExternalLink href={commit.html_url} style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {commit.sha.substring(0, 7)}
                      </ExternalLink>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>{commit.author}</span>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(commit.date).toLocaleDateString('no-NO', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </HStack>
                    <BodyShort size="small" style={{ marginTop: 'var(--ax-space-4)' }}>
                      {commit.message.split('\n')[0]}
                    </BodyShort>
                    <Detail style={{ marginTop: 'var(--ax-space-8)', color: 'var(--ax-text-danger)' }}>
                      {commit.reason}
                    </Detail>
                  </div>
                </HStack>
              </Box>
            ))}
          </VStack>
        </div>
      )}
      {capabilities.canNotify &&
        slackConfig?.enabled &&
        slackConfig?.channelId &&
        !slackConfig?.alreadySent &&
        !isApprovedStatus((deployment.four_eyes_status ?? '') as FourEyesStatus) && (
          <Box background="info-moderate" padding="space-24" borderRadius="8">
            <VStack gap="space-16">
              <Heading size="small" level="3">
                <ChatIcon aria-hidden /> Send Slack-varsel
              </Heading>
              <BodyShort>Send varsel til Slack-kanal om at dette deploymentet krever oppfølging.</BodyShort>
              <Form method="post">
                <input type="hidden" name="intent" value="send_slack_notification" />
                <Button type="submit" variant="secondary" size="small" icon={<ChatIcon aria-hidden />}>
                  Send til Slack
                </Button>
              </Form>
            </VStack>
          </Box>
        )}
      {requiresManualApproval && (
        <ManualApprovalSection
          status={status}
          deployment={deployment as never}
          previousDeploymentForDiff={previousDeploymentForDiff as never}
          isCurrentUserInvolved={isCurrentUserInvolved as never}
          involvementReason={involvementReason as never}
          capabilities={capabilities as never}
        />
      )}
      {isLegacy && !legacyInfo && !manualApproval && capabilities.canLookupLegacy && (
        <LegacyLookupSection actionData={actionData as never} userMappings={userMappings as never} />
      )}
      {(isPendingApproval || (legacyInfo && !manualApproval)) && (
        <LegacyPendingApproval legacyInfo={legacyInfo as never} capabilities={capabilities as never} />
      )}
      {manualApproval && (
        <Alert variant="success">
          <Heading size="small" level="3">
            <CheckmarkIcon aria-hidden /> Manuelt godkjent
          </Heading>
          <BodyShort>
            Godkjent av{' '}
            <strong>
              <UserName username={manualApproval.approved_by} userMappings={userMappings} />
            </strong>{' '}
            den{' '}
            {manualApproval.approved_at
              ? new Date(manualApproval.approved_at).toLocaleDateString('no-NO', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'ukjent dato'}
          </BodyShort>
          {manualApproval.comment_text && (
            <BodyShort style={{ marginTop: 'var(--ax-space-8)', fontStyle: 'italic' }}>
              "{manualApproval.comment_text}"
            </BodyShort>
          )}
          {manualApproval.slack_link && (
            <BodyShort size="small" style={{ marginTop: 'var(--ax-space-8)' }}>
              <ExternalLink href={manualApproval.slack_link}>Se Slack-dokumentasjon</ExternalLink>
            </BodyShort>
          )}
        </Alert>
      )}
      {statusHistory.length > 0 && (
        <StatusHistorySection
          statusHistory={statusHistory as never}
          deployment={deployment as never}
          previousDeployment={previousDeployment as never}
          nearbyDeployments={nearbyDeployments as never}
          verificationRun={verificationRun as never}
          isAdmin={isAdmin as never}
          userMappings={userMappings as never}
        />
      )}
      <GoalLinksSection
        goalLinks={goalLinks}
        availableBoards={availableBoards}
        sectionBoards={sectionBoards}
        canLinkGoal={capabilities.canLinkGoal}
        userMappings={userMappings}
        appInfo={goalLinkAppInfo}
        myDevTeams={myDevTeams}
      />
      <DeviationsSection
        deviations={deviations as never}
        capabilities={capabilities as never}
        userMappings={userMappings as never}
        deviationDialogRef={deviationDialogRef}
      />
      <DeviationModal modalRef={deviationDialogRef} />
      <CommentsSection
        comments={comments as never}
        capabilities={capabilities as never}
        userMappings={userMappings as never}
        commentDialogRef={commentDialogRef}
      />
      <CommentModal modalRef={commentDialogRef} />
      <ResetVerificationModal modalRef={resetVerificationDialogRef} />
    </VStack>
  )
}
