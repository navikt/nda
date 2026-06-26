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
import { GoalLinksSection } from '~/components/GoalLinksSection'
import { UserName } from '~/components/UserName'
import { type FourEyesStatus, isApprovedStatus, isProtectedStatus } from '~/lib/four-eyes-status'
import { getFourEyesStatus } from '~/lib/status-display'
import { getUserDisplayName } from '~/lib/user-display'
import { UNVERIFIED_REASON_LABELS, type UnverifiedReason } from '~/lib/verification/types'
import { CommentModal } from '~/routes/deployments/$id/CommentModal'
import { CommentsSection } from '~/routes/deployments/$id/CommentsSection'
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
      {!isApprovedStatus((deployment.four_eyes_status ?? '') as FourEyesStatus) &&
        (() => {
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
                        {commit.pr_number &&
                          deployment.detected_github_owner &&
                          deployment.detected_github_repo_name && (
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
      <DeploymentDetailsGrid deployment={deployment} userMappings={userMappings} />
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
        <PrDetailsAccordion
          deployment={deployment}
          githubPrData={deployment.github_pr_data}
          userMappings={userMappings}
        />
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
        <ManualApprovalSection
          status={status}
          deployment={deployment}
          previousDeploymentForDiff={previousDeploymentForDiff}
          isCurrentUserInvolved={isCurrentUserInvolved}
          involvementReason={involvementReason}
          capabilities={capabilities}
        />
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

      {statusHistory.length > 0 && (
        <StatusHistorySection
          statusHistory={statusHistory}
          deployment={deployment}
          previousDeployment={previousDeployment}
          nearbyDeployments={nearbyDeployments}
          verificationRun={verificationRun}
          isAdmin={isAdmin}
        />
      )}

      <GoalLinksSection
        goalLinks={goalLinks}
        availableBoards={availableBoards}
        sectionBoards={sectionBoards}
        canLinkGoal={capabilities.canLinkGoal}
        userMappings={userMappings}
      />

      <DeviationsSection
        deviations={deviations}
        capabilities={capabilities}
        userMappings={userMappings}
        deviationDialogRef={deviationDialogRef}
      />

      <DeviationModal modalRef={deviationDialogRef} />

      <CommentsSection
        comments={comments}
        capabilities={capabilities}
        userMappings={userMappings}
        commentDialogRef={commentDialogRef}
      />

      <CommentModal modalRef={commentDialogRef} />
      <ResetVerificationModal modalRef={resetVerificationDialogRef} />
    </VStack>
  )
}
