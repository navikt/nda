import { Link as AkselLink, BodyShort, Box, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import type { DeploymentDetailLoaderData } from '~/components/DeploymentDetailPage'
import type { DeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import { deploymentListUrl, deploymentViewUrl } from '~/lib/deployment-view'
import {
  approvalCommitReasonLabel,
  approvalStatusLabel,
  isRepositoryBotAuthor,
} from '~/lib/repository-code-delivery/approval-assessment-display'
import { assessmentReasonLabel } from '~/lib/repository-code-delivery/interval-assessment-display'
import { UNRESOLVED_REASON_DESCRIPTIONS } from '~/lib/repository-code-delivery/unresolved-reasons'
import type { DeploymentDetailsGridProps } from '~/routes/deployments/$id/DeploymentDetailsGrid'
import { DeploymentDetailsGrid } from '~/routes/deployments/$id/DeploymentDetailsGrid'
import type { PrDetailsAccordionProps } from '~/routes/deployments/$id/PrDetailsAccordion'
import { PrDetailsAccordion } from '~/routes/deployments/$id/PrDetailsAccordion'
import { ActionAlert } from './ActionAlert'
import { DeploymentViewLinks } from './deployments/DeploymentViewLinks'
import { ExternalLink } from './ExternalLink'
import { UserName } from './UserName'

export interface DeploymentRepositoryPageProps {
  data: DeploymentRepositoryView
  deploymentDetails: DeploymentRepositoryDetails
  actionData?: { error?: string } | null
}

type MissingLink = Extract<DeploymentRepositoryView['link'], { state: 'missing' }>
type LinkedDelivery = Extract<DeploymentRepositoryView['link'], { state: 'linked' }>
type AssessedCommit = LinkedDelivery['commits'][number]

function commitReason(commit: AssessedCommit): string {
  if (commit.reason === 'unknown_commit_author' && isRepositoryBotAuthor(commit.authorLogin)) {
    return commit.prReason
      ? `Botcommit uten PR-dekning: ${assessmentReasonLabel(commit.prReason)}`
      : 'Botcommit uten dokumentert PR-dekning'
  }
  return commit.reason === 'unknown_pr_coverage' && commit.prReason
    ? assessmentReasonLabel(commit.prReason)
    : approvalCommitReasonLabel(commit.reason)
}

function resolutionGuidance(commit: AssessedCommit): string {
  if (commit.reason === 'unknown_commit_author' && isRepositoryBotAuthor(commit.authorLogin)) {
    return 'Botkontoer skal ikke kobles til NAV-ident. Kontroller PR-godkjenningen og repositoryets innstilling for implisitt godkjenning.'
  }
  if (commit.reason === 'unknown_commit_author' || commit.reason === 'unknown_approver_identity') {
    return 'Be en administrator kontrollere GitHub-kontoens kobling til NAV-ident.'
  }
  if (commit.reason === 'unknown_pr_coverage') {
    if (commit.prReason === 'unknown_default_branch') {
      return 'Be en administrator kontrollere repositoryets registrerte default-branch.'
    }
    return 'Kontroller PR-grunnlaget og innlesingsstatusen for leveransen. Manglende eller utdaterte GitHub-data må hentes inn på nytt.'
  }
  return 'Be en administrator kontrollere leveranseintervallet og den innleste commit-historikken.'
}

function AssessmentSummary({ link }: { link: LinkedDelivery }) {
  const covered = link.assessment.commits.filter((commit) => commit.status === 'covered').length
  const notCovered = link.assessment.commits.filter((commit) => commit.status === 'not_covered').length
  const unknown = link.assessment.commits.filter((commit) => commit.status === 'unknown').length
  const unresolved = link.commits.filter((commit) => commit.status === 'unknown')
  const reasons = [...new Map(unresolved.map((commit) => [commitReason(commit), commit])).values()]
  return (
    <VStack gap="space-8">
      <BodyShort size="small">
        {covered} commits dekket · {notCovered} commits krever godkjenning · {unknown} commits har uavklart grunnlag.
      </BodyShort>
      {link.assessment.omittedCommits > 0 && (
        <BodyShort size="small">{link.assessment.omittedCommits} commits mangler i det innleste grunnlaget.</BodyShort>
      )}
      {link.assessment.totalCommits === null && (
        <BodyShort size="small">
          Totalt antall commits i intervallet er ukjent. Commit-historikken må hentes inn.
        </BodyShort>
      )}
      {link.assessment.status === 'incomplete' && reasons.length === 0 && link.assessment.totalCommits !== null && (
        <BodyShort size="small">
          Commit-historikken er ufullstendig. Kontroller innlesingen av leveranseintervallet.
        </BodyShort>
      )}
      {reasons.map((commit) => (
        <BodyShort key={commitReason(commit)} size="small">
          {commitReason(commit)}. {resolutionGuidance(commit)}
        </BodyShort>
      ))}
    </VStack>
  )
}
type DeploymentPresentation = DeploymentDetailsGridProps['deployment'] &
  PrDetailsAccordionProps['deployment'] &
  Pick<DeploymentDetailLoaderData['deployment'], 'created_at' | 'github_pr_number' | 'github_pr_url' | 'github_pr_data'>
export type DeploymentRepositoryDetails = {
  deployment: DeploymentPresentation
  displayTitle: DeploymentDetailLoaderData['displayTitle']
  previousDeploymentForDiff: DeploymentDetailLoaderData['previousDeploymentForDiff']
  previousDeploymentForDiffLabel?: string
  sameCommitMessage?: string
  userMappings: DeploymentDetailLoaderData['userMappings']
  workflowTrigger: DeploymentDetailLoaderData['workflowTrigger']
}

function missingLinkDescription(link: MissingLink): string {
  if (link.reason === 'unresolved' && link.unresolvedReason) {
    return UNRESOLVED_REASON_DESCRIPTIONS[link.unresolvedReason]
  }
  const descriptions = {
    missing_repository: 'Deploymentet mangler en stabil repositorykobling.',
    missing_commit_sha: 'Deploymentet mangler en fullstendig commit-SHA.',
    tracking_disabled: 'Registrering av kodeleveranser er ikke aktivert for repositoryet.',
    before_tracking: 'Deploymentet er fra før registreringen av kodeleveranser startet.',
    unlinked: 'Ingen kobling er registrert. Årsaken er ikke avklart; synken kan fortsatt ha arbeid igjen.',
    unresolved: 'Koblingen til en kodeleveranse er uavklart.',
  }
  return descriptions[link.reason]
}

function Range({ range }: { range: { baseSha: string; headSha: string } | null }) {
  return (
    <BodyShort size="small" style={{ overflowWrap: 'anywhere' }}>
      {range ? (
        <>
          <code>{range.baseSha}</code> → <code>{range.headSha}</code>
        </>
      ) : (
        'Sammenligningsintervall ikke tilgjengelig'
      )}
    </BodyShort>
  )
}

export function DeploymentRepositoryPage({ data, deploymentDetails, actionData }: DeploymentRepositoryPageProps) {
  const [searchParams] = useSearchParams()
  const { deployment, repository, link } = data
  const appUrl = `/team/${deployment.teamSlug}/env/${deployment.environmentName}/app/${deployment.appName}`
  const pathname = `${appUrl}/deployments/${deployment.id}`
  const repositoryUrl = repository ? `/repository/${repository.githubOwner}/${repository.githubRepoName}` : null
  const deploymentTitle =
    deploymentDetails.displayTitle ||
    deploymentDetails.deployment.github_pr_data?.title ||
    `${deployment.appName} @ ${deployment.environmentName}`
  return (
    <VStack gap="space-24">
      <ActionAlert data={actionData} />
      <HStack gap="space-16" justify="space-between" wrap>
        <DeploymentViewLinks pathname={pathname} searchParams={searchParams} currentView="repository" />
        <AkselLink as={Link} to={deploymentListUrl(`${appUrl}/deployments`, searchParams)}>
          Til deploymentlisten
        </AkselLink>
      </HStack>
      <div>
        <Heading level="1" size="large" spacing>
          {deploymentTitle}
        </Heading>
        <BodyShort textColor="subtle">
          {new Date(deploymentDetails.deployment.created_at).toLocaleString('no-NO', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
          {deploymentDetails.deployment.github_pr_number && (
            <> PR #{deploymentDetails.deployment.github_pr_number} fra appverifiseringen</>
          )}
        </BodyShort>
      </div>
      <Box padding="space-20" background="raised" borderRadius="8">
        <VStack gap="space-12">
          <Heading level="2" size="small">
            Repositorybasert vurdering
          </Heading>
          {repository && (
            <BodyShort>
              {repository.githubOwner}/{repository.githubRepoName}
            </BodyShort>
          )}
          {link.state === 'missing' ? (
            <>
              <Tag data-color="warning" variant="outline" size="small">
                Ingen tilknyttet repositoryleveranse
              </Tag>
              <BodyShort>{missingLinkDescription(link)}</BodyShort>
              {link.candidate && (
                <BodyShort>
                  Leveranse #{link.candidate.id} har samme repository og head-SHA, men er ikke koblet til dette
                  deploymentet. Den brukes derfor ikke som vurderingsgrunnlag.
                </BodyShort>
              )}
            </>
          ) : (
            <>
              <Tag
                data-color={
                  link.assessment.status === 'approved'
                    ? 'success'
                    : link.assessment.status === 'no_changes'
                      ? 'neutral'
                      : 'warning'
                }
                variant="outline"
                size="small"
              >
                {link.assessment.status === 'incomplete'
                  ? 'Uavklart grunnlag'
                  : approvalStatusLabel(link.assessment.status)}
              </Tag>
              <BodyShort size="small">Leveranse #{link.delivery.id} · låst kodeintervall:</BodyShort>
              <Range range={link.delivery} />
              {link.assessment.status === 'no_changes' && (
                <BodyShort>
                  Dette er et historikkanker uten kodeendringer, ikke en godkjenning av tidligere kode.
                </BodyShort>
              )}
              <AssessmentSummary link={link} />
              {repository && link.canAccessAdmin && link.assessment.status === 'incomplete' && (
                <AkselLink
                  as={Link}
                  to={`${repositoryUrl}/admin/code-deliveries/${link.delivery.id}?repositoryId=${repository.id}`}
                >
                  Se review-grunnlag og innlesingsstatus
                </AkselLink>
              )}
              {repository && link.canApprove && link.assessment.status === 'not_approved' && (
                <AkselLink
                  as={Link}
                  to={`${repositoryUrl}/approvals/${link.delivery.id}?repositoryId=${repository.id}`}
                >
                  Åpne felles repositorygodkjenning
                </AkselLink>
              )}
            </>
          )}
        </VStack>
      </Box>
      {link.state === 'linked' && repository && (
        <>
          {link.commits.length > 0 && (
            <div>
              <Heading level="2" size="small" spacing>
                Dekning per commit
              </Heading>
              <Table size="small">
                <caption className="aksel-sr-only">Gjeldende dekning av repositoryleveransens commits</caption>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>Commit</Table.HeaderCell>
                    <Table.HeaderCell>Commit author</Table.HeaderCell>
                    <Table.HeaderCell>PR</Table.HeaderCell>
                    <Table.HeaderCell>Vurdering</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {link.commits.map((commit) => (
                    <Table.Row key={commit.sha}>
                      <Table.DataCell>
                        <ExternalLink
                          href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/commit/${commit.sha}`}
                        >
                          <code>{commit.sha.substring(0, 7)}</code>
                        </ExternalLink>
                      </Table.DataCell>
                      <Table.DataCell>
                        <UserName username={commit.authorLogin} userMappings={data.userMappings} />
                      </Table.DataCell>
                      <Table.DataCell>
                        {commit.pullRequestNumber ? (
                          <ExternalLink
                            href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/pull/${commit.pullRequestNumber}`}
                          >
                            #{commit.pullRequestNumber}
                          </ExternalLink>
                        ) : (
                          'Ingen dokumentert PR-dekning'
                        )}
                      </Table.DataCell>
                      <Table.DataCell>{commitReason(commit)}</Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}
          <div>
            <Heading level="2" size="small" spacing>
              Deployments knyttet til samme kodeleveranse
            </Heading>
            <BodyShort size="small" spacing>
              Viser {link.deployments.length} av {link.deploymentCount} deployments.
            </BodyShort>
            <VStack gap="space-8">
              {link.deployments.map((related) => (
                <AkselLink
                  key={related.id}
                  as={Link}
                  to={deploymentViewUrl(
                    `/team/${related.teamSlug}/env/${related.environmentName}/app/${related.appName}/deployments/${related.id}`,
                    searchParams,
                    'repository',
                  )}
                >
                  {related.appName} · {related.environmentName} · {formatAuditLogTimestamp(related.createdAt)} · #
                  {related.id}
                </AkselLink>
              ))}
            </VStack>
          </div>
        </>
      )}
      <DeploymentDetailsGrid
        deployment={deploymentDetails.deployment}
        userMappings={deploymentDetails.userMappings}
        previousDeploymentForDiff={deploymentDetails.previousDeploymentForDiff}
        previousDeploymentForDiffLabel={deploymentDetails.previousDeploymentForDiffLabel}
        sameCommitMessage={deploymentDetails.sameCommitMessage}
        requireRepositoryIdentity
        workflowTrigger={deploymentDetails.workflowTrigger}
      />
      {(deploymentDetails.deployment.github_pr_data || deploymentDetails.deployment.commit_checks_data) && (
        <PrDetailsAccordion
          deployment={deploymentDetails.deployment}
          githubPrData={deploymentDetails.deployment.github_pr_data}
          commitChecksData={deploymentDetails.deployment.commit_checks_data}
          userMappings={deploymentDetails.userMappings}
        />
      )}
    </VStack>
  )
}
