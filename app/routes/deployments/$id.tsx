import {
  ArrowsCirclepathIcon,
  ChatIcon,
  CheckmarkCircleIcon,
  CheckmarkIcon,
  CircleIcon,
  ClockIcon,
  DownloadIcon,
  ExclamationmarkTriangleIcon,
  MinusCircleIcon,
  TrashIcon,
  XMarkIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import {
  Accordion,
  Alert,
  BodyShort,
  Box,
  Button,
  CopyButton,
  Detail,
  Heading,
  HGrid,
  HStack,
  Tag,
  Textarea,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form, Link, useNavigation, useSearchParams } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { BaselineInfo } from '~/components/BaselineInfo'
import { CheckAnnotations } from '~/components/CheckAnnotations'
import { CheckLogViewer } from '~/components/CheckLogViewer'
import { ExternalLink } from '~/components/ExternalLink'
import { GoalLinksSection } from '~/components/GoalLinksSection'
import { UserName } from '~/components/UserName'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
} from '~/lib/deviation-constants'
import { type FourEyesStatus, isApprovedStatus } from '~/lib/four-eyes-status'
import { formatChangeSource, getFourEyesStatus } from '~/lib/status-display'
import { getUserDisplayName } from '~/lib/user-display'
import { UNVERIFIED_REASON_LABELS, type UnverifiedReason } from '~/lib/verification/types'
import { CommentModal } from '~/routes/deployments/$id/CommentModal'
import { DeviationModal } from '~/routes/deployments/$id/DeviationModal'
import { FourEyesAlert } from '~/routes/deployments/$id/FourEyesAlert'
import { LegacyLookupSection } from '~/routes/deployments/$id/LegacyLookupSection'
import { LegacyPendingApproval } from '~/routes/deployments/$id/LegacyPendingApproval'
import type { Route } from './+types/$id'

export { action } from './$id.actions.server'
export { loader } from './$id.loader.server'

export function meta({ data }: Route.MetaArgs) {
  const deployment = data?.deployment
  return [{ title: deployment ? `Deployment #${deployment.id} - NDA` : 'Deployment' }]
}

export default function DeploymentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    deployment,
    comments,
    manualApproval,
    legacyInfo,
    statusHistory,
    deviations,
    goalLinks,
    availableBoards,
    sectionBoards,
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
  } = loaderData
  const [searchParams] = useSearchParams()
  const navigation = useNavigation()
  const isVerifying = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'verify_four_eyes'
  const [approvalReason, setApprovalReason] = useState('')
  const [approvalSlackLink, setApprovalSlackLink] = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)

  // Statuses that require manual approval (when no manualApproval exists).
  // Note: 'pending' is excluded — it means the verifier hasn't run yet, not that manual action is needed.
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

  const status = getFourEyesStatus(deployment)

  const getUserDisplay = (githubUsername: string | undefined | null) => getUserDisplayName(githubUsername, userMappings)

  return (
    <VStack gap="space-32">
      {/* Navigation buttons */}
      <HStack justify="space-between" gap="space-8">
        {/* Debug button - only shown in debug mode */}
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
      {/* Main header */}
      <div>
        <HStack align="center" gap="space-12" wrap>
          <Heading size="large" level="1" style={{ flex: 1 }}>
            {deployment.title ||
              deployment.github_pr_data?.title ||
              `${deployment.app_name} @ ${deployment.environment_name}`}
          </Heading>
          <HStack gap="space-8" align="center">
            {/* Godkjenning status tag (only shown for OK/approved states) */}
            {isApprovedStatus((deployment.four_eyes_status ?? '') as FourEyesStatus) && (
              <Tag data-color="success" variant="outline" size="small">
                {deployment.four_eyes_status === 'implicitly_approved' ? 'Implisitt godkjent' : 'Godkjent'}
              </Tag>
            )}
            {/* Method tag */}
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
            {/* Verify button for non-OK states - available to team members, teknologileder, and admin */}
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
            {/* Approve baseline button — shown for pending_baseline, or for baseline missing an attributed approver */}
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
          {new Date(deployment.created_at).toLocaleString('no-NO', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
          {deployment.github_pr_number && deployment.github_pr_url && (
            <>
              {' '}
              via <ExternalLink href={deployment.github_pr_url}>#{deployment.github_pr_number}</ExternalLink>
            </>
          )}
        </BodyShort>
      </div>
      <ActionAlert data={actionData} />
      {/* Baseline explanation — shown for baseline with no attributed approver */}
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
      {/* Branch mismatch warning - shown to all viewers when the configured
          default_branch differs from the actual base ref of related PRs.
          Auto-detection corrects monitored_applications.default_branch within 24h. */}
      {(() => {
        const branchMismatch = (
          verificationRun?.result as
            | {
                branchMismatch?: { expectedBranch: string; detectedBranches: string[]; prNumbers: number[] }
              }
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
          deployment={deployment}
          previousDeploymentForDiff={previousDeploymentForDiff}
          registeredRepos={registeredRepos}
          managingTeams={managingTeams}
          appUrl={appUrl}
          capabilities={capabilities}
          isVerifying={isVerifying}
          isAdmin={isAdmin}
          verificationRun={verificationRun}
          nearbyDeployments={nearbyDeployments}
          userMappings={userMappings}
        />
      )}

      {/* Unverified commits section */}
      {(() => {
        // Filter out commits that are already shown in the PR commits accordion or are the merge commit
        const prCommitShas = new Set(deployment.github_pr_data?.commits?.map((c: any) => c.sha) || [])
        const mergeCommitSha = deployment.github_pr_data?.merge_commit_sha
        const filteredUnverifiedCommits =
          deployment.unverified_commits?.filter(
            (commit: any) => !prCommitShas.has(commit.sha) && commit.sha !== mergeCommitSha,
          ) || []

        return (
          filteredUnverifiedCommits.length > 0 && (
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
                {filteredUnverifiedCommits.map((commit: any) => (
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
          )
        )
      })()}
      {/* Deployment Details Section */}
      <Heading size="medium" level="2">
        Detaljer
      </Heading>
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, md: 3 }}>
        <VStack gap="space-4">
          <Detail>Deployer</Detail>
          <BodyShort>
            <UserName username={deployment.deployer_username} userMappings={userMappings} link="github" />
          </BodyShort>
        </VStack>

        <VStack gap="space-4">
          <Detail>Commit SHA</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              {deployment.commit_sha ? (
                <ExternalLink
                  href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                  style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                >
                  {deployment.commit_sha.substring(0, 7)}
                </ExternalLink>
              ) : (
                <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>(ukjent)</span>
              )}
            </BodyShort>
            {deployment.commit_sha && <CopyButton copyText={deployment.commit_sha} size="small" title="Kopier SHA" />}
          </HStack>
        </VStack>

        {deployment.branch_name && (
          <VStack gap="space-4">
            <Detail>Branch</Detail>
            <BodyShort>
              <ExternalLink
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/tree/${deployment.branch_name}`}
                style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
              >
                {deployment.branch_name}
              </ExternalLink>
            </BodyShort>
          </VStack>
        )}

        {deployment.parent_commits && deployment.parent_commits.length > 1 && (
          <VStack gap="space-4">
            <Detail>Merge commit (parents)</Detail>
            <BodyShort>
              {deployment.parent_commits.map((parent, index) => (
                <span key={parent.sha}>
                  <ExternalLink
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${parent.sha}`}
                    style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                  >
                    {parent.sha.substring(0, 7)}
                  </ExternalLink>
                  {index < (deployment.parent_commits?.length ?? 0) - 1 && ', '}
                </span>
              ))}
            </BodyShort>
          </VStack>
        )}

        {deployment.trigger_url && (
          <VStack gap="space-4">
            <Detail>GitHub Actions</Detail>
            <BodyShort>
              <ExternalLink href={deployment.trigger_url}>Se workflow run</ExternalLink>
            </BodyShort>
          </VStack>
        )}

        <VStack gap="space-4">
          <Detail>Nais Deployment ID</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{deployment.nais_deployment_id}</code>
            </BodyShort>
            <CopyButton copyText={deployment.nais_deployment_id} size="small" title="Kopier deployment ID" />
          </HStack>
        </VStack>

        {/* PR-specific fields in same grid */}

        {deployment.github_pr_data && (
          <>
            <VStack gap="space-4">
              <Detail>PR Opprettet av</Detail>
              <BodyShort>
                <UserName
                  username={deployment.github_pr_data.creator?.username}
                  userMappings={userMappings}
                  link="github"
                />
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merger && (
              <VStack gap="space-4">
                <Detail>Merget av</Detail>
                <BodyShort>
                  <UserName
                    username={deployment.github_pr_data.merger.username}
                    userMappings={userMappings}
                    link="github"
                  />
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Opprettet</Detail>
              <BodyShort>
                {new Date(deployment.github_pr_data.created_at).toLocaleString('no-NO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merged_at && (
              <VStack gap="space-4">
                <Detail>Merget</Detail>
                <BodyShort>
                  {new Date(deployment.github_pr_data.merged_at).toLocaleString('no-NO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>Base branch</Detail>
              <BodyShort>{deployment.github_pr_data.base_branch}</BodyShort>
            </VStack>

            {deployment.github_pr_data.head_branch && (
              <VStack gap="space-4">
                <Detail>Head branch</Detail>
                <BodyShort>{deployment.github_pr_data.head_branch}</BodyShort>
              </VStack>
            )}

            {deployment.github_pr_data.merge_commit_sha && (
              <VStack gap="space-4">
                <Detail>Merge commit</Detail>
                <BodyShort>
                  <ExternalLink
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.github_pr_data.merge_commit_sha}`}
                  >
                    {deployment.github_pr_data.merge_commit_sha.substring(0, 7)}
                  </ExternalLink>
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Status</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.draft && (
                  <Tag data-color="warning" variant="outline" size="small">
                    Draft
                  </Tag>
                )}
                {deployment.github_pr_data.locked && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    🔒 Låst
                  </Tag>
                )}
                {deployment.github_pr_data.auto_merge && (
                  <Tag data-color="info" variant="outline" size="small">
                    Auto-merge ({deployment.github_pr_data.auto_merge.merge_method})
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === true && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} /> Checks OK
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === false && (
                  <Tag data-color="danger" variant="outline" size="small">
                    <XMarkIcon aria-hidden /> Checks failed
                  </Tag>
                )}
              </HStack>
            </VStack>

            {deployment.github_pr_data.assignees && deployment.github_pr_data.assignees.length > 0 && (
              <VStack gap="space-4">
                <Detail>Tildelt</Detail>
                <HStack gap="space-8" wrap>
                  {deployment.github_pr_data.assignees.map((a) => (
                    <Tag data-color="neutral" key={a.username} variant="outline" size="small">
                      {getUserDisplay(a.username)}
                    </Tag>
                  ))}
                </HStack>
              </VStack>
            )}

            {deployment.github_pr_data.milestone && (
              <VStack gap="space-4">
                <Detail>Milestone</Detail>
                <Tag data-color="info" variant="outline" size="small">
                  {deployment.github_pr_data.milestone.title} ({deployment.github_pr_data.milestone.state})
                </Tag>
              </VStack>
            )}
          </>
        )}
      </HGrid>
      {/* PR Approvers - shown prominently before the accordion */}
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
                    {getUserDisplay(reviewer.username)}
                  </ExternalLink>
                </Tag>
              ))}
          </HStack>
        </VStack>
      )}
      {/* PR Details Accordion - Reviewers, Checks, Commits */}
      {deployment.github_pr_data && (
        <Accordion>
          {/* Reviewers - includes requested and completed reviews */}
          {((deployment.github_pr_data.reviewers && deployment.github_pr_data.reviewers.length > 0) ||
            (deployment.github_pr_data.requested_reviewers &&
              deployment.github_pr_data.requested_reviewers.length > 0) ||
            (deployment.github_pr_data.requested_teams && deployment.github_pr_data.requested_teams.length > 0)) && (
            <Accordion.Item>
              <Accordion.Header>
                Reviewers (
                {(deployment.github_pr_data.reviewers?.length || 0) +
                  (deployment.github_pr_data.requested_reviewers?.length || 0) +
                  (deployment.github_pr_data.requested_teams?.length || 0)}
                )
              </Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-8">
                  {/* Completed reviews */}
                  {deployment.github_pr_data.reviewers?.map((reviewer) => (
                    <HStack key={`${reviewer.username}:${reviewer.submitted_at}`} gap="space-8" align="center">
                      {reviewer.state === 'APPROVED' && (
                        <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
                      )}
                      {reviewer.state === 'CHANGES_REQUESTED' && (
                        <XMarkIcon aria-hidden style={{ color: 'var(--ax-text-danger)' }} />
                      )}
                      {reviewer.state === 'COMMENTED' && (
                        <ChatIcon aria-hidden style={{ color: 'var(--ax-text-neutral-subtle)' }} />
                      )}
                      <ExternalLink href={`https://github.com/${reviewer.username}`}>
                        {getUserDisplay(reviewer.username)}
                      </ExternalLink>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(reviewer.submitted_at).toLocaleString('no-NO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </HStack>
                  ))}

                  {/* Requested reviewers (pending) */}
                  {deployment.github_pr_data.requested_reviewers?.map((r) => (
                    <HStack key={`pending:${r.username}`} gap="space-8" align="center">
                      <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                      <ExternalLink href={`https://github.com/${r.username}`}>
                        {getUserDisplay(r.username)}
                      </ExternalLink>
                    </HStack>
                  ))}

                  {/* Requested teams (pending) */}
                  {deployment.github_pr_data.requested_teams?.map((t) => (
                    <HStack key={`team:${t.slug}`} gap="space-8" align="center">
                      <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                      <span>{t.name}</span>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* GitHub Checks */}
          {deployment.github_pr_data.checks && deployment.github_pr_data.checks.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>GitHub Checks ({deployment.github_pr_data.checks.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.checks.map((check) => {
                    const isSuccess = check.conclusion === 'success'
                    const isFailure =
                      check.conclusion === 'failure' ||
                      check.conclusion === 'timed_out' ||
                      check.conclusion === 'action_required'
                    const isSkipped =
                      check.conclusion === 'skipped' ||
                      check.conclusion === 'neutral' ||
                      check.conclusion === 'cancelled'
                    const isInProgress = check.status === 'in_progress' || check.status === 'queued'

                    const duration =
                      check.started_at && check.completed_at
                        ? Math.round(
                            (new Date(check.completed_at).getTime() - new Date(check.started_at).getTime()) / 1000,
                          )
                        : null
                    const durationStr =
                      duration !== null
                        ? duration >= 60
                          ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                          : `${duration}s`
                        : null

                    return (
                      <VStack key={check.html_url ?? check.name} gap="space-4">
                        <HStack gap="space-8" align="center" wrap>
                          {isSuccess && <CheckmarkCircleIcon style={{ color: 'var(--ax-text-success)' }} />}
                          {isFailure && <XMarkOctagonIcon style={{ color: 'var(--ax-text-danger)' }} />}
                          {isSkipped && <MinusCircleIcon style={{ color: 'var(--ax-text-neutral-subtle)' }} />}
                          {isInProgress && <ClockIcon style={{ color: 'var(--ax-text-warning)' }} />}

                          {check.html_url ? (
                            <ExternalLink href={check.html_url}>{check.name}</ExternalLink>
                          ) : (
                            <span>{check.name}</span>
                          )}

                          <Tag
                            variant={isSuccess ? 'success' : isFailure ? 'error' : isSkipped ? 'neutral' : 'warning'}
                            size="small"
                          >
                            {check.conclusion || check.status}
                          </Tag>

                          {check.app?.name && <Detail textColor="subtle">{check.app.name}</Detail>}

                          {durationStr && <Detail textColor="subtle">{durationStr}</Detail>}

                          {check.output?.annotations_count != null && check.output.annotations_count > 0 && (
                            <Tag variant="warning" size="small">
                              {check.output.annotations_count} annotation
                              {check.output.annotations_count !== 1 ? 's' : ''}
                            </Tag>
                          )}

                          {check.details_url && check.details_url !== check.html_url && (
                            <ExternalLink href={check.details_url}>
                              <Detail textColor="subtle">detaljer</Detail>
                            </ExternalLink>
                          )}

                          {check.log_cached && (
                            <Tag variant="info" size="small">
                              Logg lagret
                            </Tag>
                          )}
                        </HStack>

                        {check.output?.title && (
                          <Detail textColor="subtle" style={{ paddingLeft: 'var(--ax-space-24)' }}>
                            {check.output.title}
                          </Detail>
                        )}

                        {check.output?.summary && isFailure && (
                          <Box
                            paddingInline="space-24"
                            paddingBlock="space-4"
                            style={{ maxHeight: '200px', overflow: 'auto' }}
                          >
                            <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                              {check.output.summary}
                            </pre>
                          </Box>
                        )}

                        {check.id && (
                          <CheckLogViewer
                            owner={deployment.detected_github_owner}
                            repo={deployment.detected_github_repo_name}
                            jobId={check.id}
                            appSlug={check.app?.slug ?? null}
                            conclusion={check.conclusion}
                          />
                        )}

                        {check.output?.annotations_count != null && check.output.annotations_count > 0 && check.id && (
                          <CheckAnnotations
                            owner={deployment.detected_github_owner}
                            repo={deployment.detected_github_repo_name}
                            checkRunId={check.id}
                            storedAnnotations={check.annotations ?? null}
                          />
                        )}
                      </VStack>
                    )
                  })}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* PR Commits */}
          {deployment.github_pr_data.commits && deployment.github_pr_data.commits.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>Commits ({deployment.github_pr_data.commits.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.commits.map((commit) => (
                    <HStack key={commit.sha} gap="space-12" align="start">
                      {commit.author?.avatar_url && (
                        <img
                          src={commit.author.avatar_url}
                          alt={getUserDisplay(commit.author.username) ?? ''}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <VStack gap="space-4">
                        <HStack gap="space-8" align="baseline" wrap>
                          <ExternalLink
                            href={commit.html_url}
                            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                          >
                            {commit.sha.substring(0, 7)}
                          </ExternalLink>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {getUserDisplay(commit.author?.username)}
                          </span>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(commit.date).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </HStack>
                        <BodyShort>{commit.message.split('\n')[0]}</BodyShort>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* GitHub Comments */}
          {deployment.github_pr_data.comments && deployment.github_pr_data.comments.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>Kommentarer ({deployment.github_pr_data.comments.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.comments.map((comment) => (
                    <HStack key={comment.id} gap="space-12" align="start">
                      {comment.user?.avatar_url && (
                        <img
                          src={comment.user.avatar_url}
                          alt={getUserDisplay(comment.user?.username) ?? ''}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <VStack gap="space-4" style={{ flex: 1 }}>
                        <HStack gap="space-8" align="baseline" wrap>
                          <ExternalLink href={`https://github.com/${comment.user?.username ?? ''}`}>
                            {getUserDisplay(comment.user?.username) ?? 'ukjent'}
                          </ExternalLink>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(comment.created_at).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                          <ExternalLink href={comment.html_url} style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            vis på GitHub
                          </ExternalLink>
                        </HStack>
                        <BodyShort style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</BodyShort>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}
        </Accordion>
      )}
      {/* Resources section */}
      {deployment.resources && deployment.resources.length > 0 && (
        <div>
          <Heading size="small" level="3" spacing>
            Kubernetes Resources
          </Heading>
          <HStack gap="space-8" wrap>
            {deployment.resources.map((resource: any) => (
              <Tag data-color="info" key={`${resource.kind}:${resource.name}`} variant="outline" size="small">
                {resource.kind}: {resource.name}
              </Tag>
            ))}
          </HStack>
        </div>
      )}
      {/* PR Details section */}
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

          {/* PR Stats */}
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

          {/* Labels */}
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
      {/* Unreviewed commits warning */}
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
      {/* Send Slack notification */}
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
      {/* Manual approval section - for deployments needing manual approval */}
      {requiresManualApproval && (
        <Box background="warning-moderate" padding="space-24" borderRadius="8">
          <VStack gap="space-16">
            <Heading size="small" level="3">
              <ExclamationmarkTriangleIcon aria-hidden /> Krever manuell godkjenning
            </Heading>
            <BodyShort>
              Dette deploymentet har status "{status.text}" og krever manuell godkjenning for å oppfylle
              fire-øyne-prinsippet.
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

            {isCurrentUserInvolved ? (
              <Alert variant="warning">
                <Heading size="xsmall" level="4" spacing>
                  Du kan ikke godkjenne dette deploymentet
                </Heading>
                <BodyShort>{involvementReason}</BodyShort>
                <BodyShort style={{ marginTop: 'var(--ax-space-8)' }}>
                  Fire-øyne-prinsippet krever at en annen person godkjenner.
                </BodyShort>
              </Alert>
            ) : !capabilities.canApprove ? (
              <Alert variant="info">
                <BodyShort>Du har ikke tilgang til å godkjenne denne deploymenten.</BodyShort>
              </Alert>
            ) : !showApprovalForm ? (
              <Button variant="primary" onClick={() => setShowApprovalForm(true)}>
                Godkjenn manuelt
              </Button>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="manual_approval" />
                <VStack gap="space-16">
                  <TextField
                    label="Slack-lenke (valgfritt)"
                    name="slack_link"
                    value={approvalSlackLink}
                    onChange={(e) => setApprovalSlackLink(e.target.value)}
                    description="Lenke til Slack-tråd hvor kode-review er dokumentert"
                    size="small"
                  />
                  <Textarea
                    label="Begrunnelse (valgfritt)"
                    name="reason"
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    description="F.eks: 'Hotfix reviewet i Slack av kollega'"
                    size="small"
                    rows={2}
                  />
                  <HStack gap="space-8">
                    <Button type="submit" variant="primary" size="small">
                      Godkjenn
                    </Button>
                    <Button type="button" variant="secondary" size="small" onClick={() => setShowApprovalForm(false)}>
                      Avbryt
                    </Button>
                  </HStack>
                </VStack>
              </Form>
            )}
          </VStack>
        </Box>
      )}

      {/* Legacy deployment - GitHub lookup section */}
      {isLegacy && !legacyInfo && !manualApproval && capabilities.canLookupLegacy && (
        <LegacyLookupSection actionData={actionData} userMappings={userMappings} />
      )}

      {/* Legacy deployment - pending approval (registered but needs approval from someone else) */}
      {(isPendingApproval || (legacyInfo && !manualApproval)) && (
        <LegacyPendingApproval legacyInfo={legacyInfo} capabilities={capabilities} />
      )}

      {/* Show existing manual approval if present */}
      {manualApproval && (
        <Alert variant="success">
          <Heading size="small" level="3">
            <CheckmarkIcon aria-hidden /> Manuelt godkjent
          </Heading>
          <BodyShort>
            Godkjent av <strong>{manualApproval.approved_by}</strong> den{' '}
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
      {/* Status history section */}
      {statusHistory.length > 0 && (
        <VStack gap="space-16">
          <HStack justify="space-between" align="center">
            <Heading size="medium" level="2">
              Statushistorikk
            </Heading>
            {isAdmin && verificationRun && (
              <Button
                variant="tertiary"
                size="small"
                icon={<DownloadIcon aria-hidden />}
                onClick={() => {
                  const data = {
                    deploymentId: deployment.id,
                    commitSha: deployment.commit_sha,
                    previousDeployment: previousDeployment
                      ? {
                          id: previousDeployment.id,
                          commitSha: previousDeployment.commit_sha,
                          createdAt: previousDeployment.created_at,
                          fourEyesStatus: previousDeployment.four_eyes_status,
                        }
                      : null,
                    nearbyDeployments: nearbyDeployments.map((nd) => ({
                      id: nd.id,
                      commitSha: nd.commit_sha,
                      createdAt: nd.created_at,
                      fourEyesStatus: nd.four_eyes_status,
                      deployerUsername: nd.deployer_username,
                    })),
                    verification: {
                      status: verificationRun.status,
                      runAt: verificationRun.runAt,
                      schemaVersion: verificationRun.schemaVersion,
                      result: verificationRun.result,
                    },
                  }
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `begrunnelse-deployment-${deployment.id}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Last ned begrunnelse
              </Button>
            )}
          </HStack>
          <VStack gap="space-8">
            {statusHistory.map((transition) => (
              <Box key={transition.id} padding="space-12" borderRadius="4" borderColor="neutral-subtle" borderWidth="1">
                <HStack gap="space-8" align="center" wrap>
                  <Tag variant="neutral" size="small">
                    {formatChangeSource(transition.change_source)}
                  </Tag>
                  <BodyShort size="small">
                    {transition.from_status ? (
                      <>
                        <Tag
                          variant={isApprovedStatus(transition.from_status as FourEyesStatus) ? 'success' : 'warning'}
                          size="xsmall"
                        >
                          {transition.from_status}
                        </Tag>
                        {' → '}
                      </>
                    ) : (
                      'Satt til '
                    )}
                    <Tag
                      variant={isApprovedStatus(transition.to_status as FourEyesStatus) ? 'success' : 'warning'}
                      size="xsmall"
                    >
                      {transition.to_status}
                    </Tag>
                  </BodyShort>
                  {transition.changed_by && <Detail textColor="subtle">av {transition.changed_by}</Detail>}
                  <Detail textColor="subtle">
                    {new Date(transition.created_at).toLocaleString('no-NO', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Detail>
                </HStack>
              </Box>
            ))}
          </VStack>
        </VStack>
      )}
      {/* Goal links / origin of change section */}
      <GoalLinksSection
        goalLinks={goalLinks}
        availableBoards={availableBoards}
        sectionBoards={sectionBoards}
        canLinkGoal={capabilities.canLinkGoal}
        userMappings={userMappings}
      />

      {/* Deviations section */}
      <VStack gap="space-16">
        <HStack justify="space-between" align="center">
          <Heading size="medium" level="2">
            Avvik
          </Heading>
          {capabilities.canDeviate && (
            <Button
              variant="tertiary"
              size="small"
              icon={<ExclamationmarkTriangleIcon aria-hidden />}
              onClick={() => deviationDialogRef.current?.showModal()}
            >
              Registrer avvik
            </Button>
          )}
        </HStack>

        {deviations.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen avvik registrert.
          </BodyShort>
        ) : (
          <VStack gap="space-12">
            {deviations.map((deviation) => (
              <Box
                key={deviation.id}
                padding="space-16"
                borderRadius="8"
                background="raised"
                borderColor="warning-subtle"
                borderWidth="1"
              >
                <VStack gap="space-4">
                  <HStack gap="space-8" align="center">
                    <ExclamationmarkTriangleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                    <Detail textColor="subtle">
                      {new Date(deviation.created_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {' — '}
                      {deviation.registered_by_name || getUserDisplay(deviation.registered_by)}
                    </Detail>
                    {deviation.resolved_at ? (
                      <Tag size="xsmall" variant="moderate" data-color="success">
                        Løst
                      </Tag>
                    ) : (
                      <Tag size="xsmall" variant="moderate" data-color="warning">
                        Åpen
                      </Tag>
                    )}
                    {deviation.severity && (
                      <Tag
                        size="xsmall"
                        variant="moderate"
                        data-color={
                          deviation.severity === 'critical' || deviation.severity === 'high'
                            ? 'danger'
                            : deviation.severity === 'medium'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {DEVIATION_SEVERITY_LABELS[deviation.severity]}
                      </Tag>
                    )}
                  </HStack>
                  {deviation.breach_type && (
                    <BodyShort size="small" weight="semibold">
                      {deviation.breach_type}
                    </BodyShort>
                  )}
                  <BodyShort>{deviation.reason}</BodyShort>
                  <HStack gap="space-12" wrap>
                    {deviation.intent && (
                      <Detail textColor="subtle">Intensjon: {DEVIATION_INTENT_LABELS[deviation.intent]}</Detail>
                    )}
                    {deviation.follow_up_role && (
                      <Detail textColor="subtle">
                        Oppfølging: {DEVIATION_FOLLOW_UP_ROLE_LABELS[deviation.follow_up_role]}
                      </Detail>
                    )}
                  </HStack>
                  {deviation.resolved_at && deviation.resolution_note && (
                    <BodyShort size="small" textColor="subtle">
                      Løsning: {deviation.resolution_note}
                      {(deviation.resolved_by_name ?? deviation.resolved_by) && (
                        <> — løst av {deviation.resolved_by_name || getUserDisplay(deviation.resolved_by)}</>
                      )}
                    </BodyShort>
                  )}
                </VStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>

      <DeviationModal modalRef={deviationDialogRef} />

      {/* Comments section */}
      <VStack gap="space-16">
        <Heading size="medium" level="2">
          Kommentarer
        </Heading>

        {comments.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen kommentarer ennå.
          </BodyShort>
        ) : (
          <VStack gap="space-12">
            {comments.map((comment) => (
              <Box
                key={comment.id}
                padding="space-16"
                borderRadius="8"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
              >
                <HStack justify="space-between" align="start">
                  <VStack gap="space-4">
                    <Detail textColor="subtle">
                      {new Date(comment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {comment.registered_by && (
                        <>
                          {' — '}
                          {getUserDisplay(comment.registered_by)}
                        </>
                      )}
                    </Detail>
                    <BodyShort>{comment.comment_text}</BodyShort>
                    {comment.slack_link && (
                      <BodyShort size="small">
                        <ExternalLink href={comment.slack_link}>🔗 Slack-lenke</ExternalLink>
                      </BodyShort>
                    )}
                  </VStack>
                  {capabilities.canDeviate && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete_comment" />
                      <input type="hidden" name="comment_id" value={comment.id} />
                      <Button type="submit" size="small" variant="tertiary" icon={<TrashIcon aria-hidden />}>
                        Slett
                      </Button>
                    </Form>
                  )}
                </HStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>
      <Button variant="tertiary" icon={<ChatIcon aria-hidden />} onClick={() => commentDialogRef.current?.showModal()}>
        Legg til kommentar
      </Button>

      <CommentModal modalRef={commentDialogRef} />
    </VStack>
  )
}
