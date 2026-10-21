import { Link as AkselLink, Alert, BodyShort, Box, Heading, HGrid, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import type { DeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import { deploymentListUrl, deploymentViewUrl } from '~/lib/deployment-view'
import {
  approvalCommitReasonLabel,
  approvalStatusLabel,
} from '~/lib/repository-code-delivery/approval-assessment-display'
import { UNRESOLVED_REASON_DESCRIPTIONS } from '~/lib/repository-code-delivery/unresolved-reasons'
import { ActionAlert } from './ActionAlert'
import { StatusTag } from './deployment-tags'
import { DeploymentViewLinks } from './deployments/DeploymentViewLinks'
import { ExternalLink } from './ExternalLink'
import { UserName } from './UserName'

export interface DeploymentRepositoryPageProps {
  data: DeploymentRepositoryView
  actionData?: { error?: string } | null
}

type MissingLink = Extract<DeploymentRepositoryView['link'], { state: 'missing' }>

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

export function DeploymentRepositoryPage({ data, actionData }: DeploymentRepositoryPageProps) {
  const [searchParams] = useSearchParams()
  const { deployment, application, repository, link } = data
  const appUrl = `/team/${deployment.teamSlug}/env/${deployment.environmentName}/app/${deployment.appName}`
  const pathname = `${appUrl}/deployments/${deployment.id}`
  const repositoryUrl = repository ? `/repository/${repository.githubOwner}/${repository.githubRepoName}` : null

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
          Repositoryvurdering av deployment #{deployment.id}
        </Heading>
        <BodyShort>
          {deployment.appName} · {deployment.environmentName} · {formatAuditLogTimestamp(deployment.createdAt)}
        </BodyShort>
        <BodyShort size="small">
          Deployet av <UserName username={data.deployerUsername} userMappings={data.userMappings} />
        </BodyShort>
        <BodyShort size="small">Deploymentets SHA: {deployment.commitSha ?? 'Ukjent'}</BodyShort>
      </div>
      <Alert variant="info" size="small">
        Dette er en skrivebeskyttet sammenligning. Repositorydekningen beregnes fra lagret grunnlag nå, ikke ved
        deploymenttidspunktet. Den endrer ikke gjeldende appbasert status og beviser ikke at koden var godkjent før
        deployment.
      </Alert>
      <HGrid columns={{ xs: 1, lg: 2 }} gap="space-24">
        <Box padding="space-20" background="raised" borderRadius="8">
          <VStack gap="space-12">
            <Heading level="2" size="small">
              Appbasert vurdering
            </Heading>
            {application.status ? (
              <StatusTag four_eyes_status={application.status} />
            ) : (
              <BodyShort>Appbasert status mangler.</BodyShort>
            )}
            <BodyShort size="small">
              {application.verificationRunAt
                ? `Intervall fra siste verifiseringskjøring ${formatAuditLogTimestamp(application.verificationRunAt)}:`
                : 'Ingen appbasert verifiseringskjøring er lagret.'}
            </BodyShort>
            <Range range={application.range} />
            <AkselLink as={Link} to={deploymentViewUrl(pathname, searchParams, 'application')}>
              Åpne appbasert grunnlag og historikk
            </AkselLink>
          </VStack>
        </Box>
        <Box padding="space-20" background="raised" borderRadius="8">
          <VStack gap="space-12">
            <Heading level="2" size="small">
              Repositorydekning nå
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
                  {approvalStatusLabel(link.assessment.status)}
                </Tag>
                <BodyShort size="small">Leveranse #{link.delivery.id} · låst kodeintervall:</BodyShort>
                <Range range={link.delivery} />
                {link.assessment.status === 'no_changes' && (
                  <BodyShort>
                    Dette er et historikkanker uten kodeendringer, ikke en godkjenning av tidligere kode.
                  </BodyShort>
                )}
                {link.assessment.status === 'incomplete' && (
                  <BodyShort>
                    Grunnlaget er ufullstendig. Det betyr ikke at review mangler eller at koden er godkjent.
                  </BodyShort>
                )}
                {link.assessment.totalCommits === null ? (
                  <BodyShort size="small">
                    {link.assessment.listedCommits} commits vurdert; totalt antall er ukjent.
                  </BodyShort>
                ) : (
                  <BodyShort size="small">
                    {link.assessment.listedCommits} av {link.assessment.totalCommits} commits vurdert.
                  </BodyShort>
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
      </HGrid>
      <Alert variant="info" size="small">
        Modellene kan vurdere forskjellige kodeintervaller. Kodedekning er ikke en samlet deploymentgodkjenning og
        overstyrer ikke kilde- eller branchkontroller. Disse kontrollene må leses i den appbaserte vurderingen.
        {deployment.branchName ? ` Registrert branch: ${deployment.branchName}.` : ' Registrert branch er ukjent.'}
      </Alert>
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
                      <Table.DataCell>{approvalCommitReasonLabel(commit.reason)}</Table.DataCell>
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
    </VStack>
  )
}
