import { ArrowsCirclepathIcon } from '@navikt/aksel-icons'
import { Alert, BodyLong, BodyShort, Button, Heading, HStack, ReadMore, Table, Tag, VStack } from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import { BaselineInfo } from '~/components/BaselineInfo'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import { type FourEyesStatus, getFourEyesStatusLabel, isApprovedStatus } from '~/lib/four-eyes-status'
import { mergeWithCurrentDeploy } from '~/lib/nearby-deploys'
import type { getFourEyesStatus } from '~/lib/status-display'
import { UNVERIFIED_REASON_DESCRIPTIONS, type UnverifiedReason } from '~/lib/verification/types'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type FourEyesAlertProps = {
  status: ReturnType<typeof getFourEyesStatus>
  isVerifying: boolean

  deployment: LoaderData['deployment']
  previousDeploymentForDiff: LoaderData['previousDeploymentForDiff']
  registeredRepos: LoaderData['registeredRepos']
  managingTeams: LoaderData['managingTeams']
  appUrl: LoaderData['appUrl']
  capabilities: LoaderData['capabilities']
  isAdmin: LoaderData['isAdmin']
  verificationRun: LoaderData['verificationRun']
  nearbyDeployments: LoaderData['nearbyDeployments']
  userMappings: LoaderData['userMappings']
}

export function FourEyesAlert({
  status,
  deployment,
  previousDeploymentForDiff,
  registeredRepos,
  managingTeams,
  appUrl,
  capabilities,
  isVerifying,
  isAdmin,
  verificationRun,
  nearbyDeployments,
  userMappings,
}: FourEyesAlertProps) {
  return (
    <Alert variant={status.variant}>
      <Heading size="small" level="3" spacing>
        {status.text}
      </Heading>
      <VStack gap="space-8">
        <BodyShort>{status.description}</BodyShort>
        {deployment.four_eyes_status === 'pending_baseline' && <BaselineInfo />}
        {/* Reason-specific explanation for unverified_commits */}
        {deployment.four_eyes_status === 'unverified_commits' &&
          (() => {
            const commits = deployment.unverified_commits
            if (!commits || commits.length === 0) return null
            const reasons = new Set(commits.map((c: { reason?: string }) => c.reason).filter(Boolean))
            const primaryReason = (reasons.size === 1 ? [...reasons][0] : null) as UnverifiedReason | null
            const prNumber = commits[0]?.pr_number ?? deployment.github_pr_number
            const prUrl =
              prNumber && deployment.detected_github_owner && deployment.detected_github_repo_name
                ? `https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/pull/${prNumber}`
                : null
            return (
              <>
                {primaryReason && (
                  <BodyShort>
                    <strong>Årsak:</strong> {UNVERIFIED_REASON_DESCRIPTIONS[primaryReason]}
                  </BodyShort>
                )}
                <HStack gap="space-12" wrap>
                  {prUrl && <ExternalLink href={prUrl}>Se PR #{prNumber} på GitHub</ExternalLink>}
                  {previousDeploymentForDiff?.commit_sha && deployment.commit_sha && (
                    <ExternalLink
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeploymentForDiff.commit_sha}...${deployment.commit_sha}`}
                    >
                      Se endringer mellom deployments
                    </ExternalLink>
                  )}
                </HStack>
              </>
            )
          })()}
        {/* Branch details for unauthorized_branch */}
        {deployment.four_eyes_status === 'unauthorized_branch' &&
          (() => {
            const defaultBranch = deployment.default_branch
            const shortSha = deployment.commit_sha?.slice(0, 7)
            return (
              <VStack gap="space-4">
                {deployment.branch_name && (
                  <BodyShort>
                    <strong>Deployet fra branch:</strong> <code>{deployment.branch_name}</code>
                  </BodyShort>
                )}
                {defaultBranch ? (
                  <BodyShort>
                    <strong>Konfigurert default-branch:</strong> <code>{defaultBranch}</code>
                  </BodyShort>
                ) : (
                  <BodyShort>
                    <strong>Konfigurert default-branch:</strong>{' '}
                    <em>(ikke satt ennå — auto-sync fyller inn innen 5 minutter)</em>
                  </BodyShort>
                )}
                {shortSha && (
                  <BodyShort>
                    <strong>Deployet commit:</strong> <code>{shortSha}</code>
                  </BodyShort>
                )}
                {deployment.commit_sha && deployment.detected_github_owner && deployment.detected_github_repo_name && (
                  <HStack gap="space-12" wrap>
                    <ExternalLink
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                    >
                      Se commit på GitHub
                    </ExternalLink>
                    {defaultBranch && (
                      <ExternalLink
                        href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/tree/${encodeURIComponent(defaultBranch)}`}
                      >
                        Se {defaultBranch}-branchen
                      </ExternalLink>
                    )}
                  </HStack>
                )}
              </VStack>
            )
          })()}
        {/* Repo details for unauthorized_repository */}
        {deployment.four_eyes_status === 'unauthorized_repository' &&
          deployment.detected_github_owner &&
          deployment.detected_github_repo_name && (
            <VStack gap="space-4">
              <BodyShort>
                <strong>Deployet fra repo:</strong>{' '}
                <ExternalLink
                  href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`}
                >
                  {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
                </ExternalLink>
              </BodyShort>
              {registeredRepos.length > 0 && (
                <BodyShort>
                  <strong>Godkjente repoer:</strong>{' '}
                  {registeredRepos.map((r, idx) => (
                    <span key={`${r.owner}/${r.name}`}>
                      {idx > 0 ? ', ' : ''}
                      <ExternalLink href={`https://github.com/${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                      </ExternalLink>
                    </span>
                  ))}
                </BodyShort>
              )}
              {managingTeams.length > 0 && (
                <BodyShort>
                  <strong>{managingTeams.length === 1 ? 'Ansvarlig team:' : 'Ansvarlige team:'}</strong>{' '}
                  {managingTeams.map((t, idx) => (
                    <span key={t.slug}>
                      {idx > 0 ? ', ' : ''}
                      <Link to={`/sections/${t.sectionSlug}/teams/${t.slug}`}>{t.name}</Link>
                    </span>
                  ))}
                </BodyShort>
              )}
              <BodyShort>
                Team-administratorer (produktleder/tech lead) kan godkjenne repoet fra{' '}
                <Link to={`${appUrl}`}>app-siden</Link>.
              </BodyShort>
            </VStack>
          )}
        {/* Generic compare link for approved_pr_with_unreviewed (no reason breakdown) */}
        {deployment.four_eyes_status === 'approved_pr_with_unreviewed' &&
          previousDeploymentForDiff?.commit_sha &&
          deployment.commit_sha && (
            <BodyShort>
              <ExternalLink
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeploymentForDiff.commit_sha}...${deployment.commit_sha}`}
              >
                Se endringer på GitHub
              </ExternalLink>
            </BodyShort>
          )}
        {/* Compare link for other non-approved statuses */}
        {deployment.four_eyes_status !== 'unverified_commits' &&
          deployment.four_eyes_status !== 'approved_pr_with_unreviewed' &&
          previousDeploymentForDiff?.commit_sha &&
          deployment.commit_sha &&
          ['direct_push', 'missing', 'pr_not_approved'].includes(deployment.four_eyes_status ?? '') && (
            <BodyShort>
              <ExternalLink
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeploymentForDiff.commit_sha}...${deployment.commit_sha}`}
              >
                Se endringer på GitHub
              </ExternalLink>
            </BodyShort>
          )}
      </VStack>
      {deployment.four_eyes_status === 'pending' && capabilities.canVerify && deployment.commit_sha && (
        <VStack gap="space-8" marginBlock="space-8 space-0">
          <BodyShort>Du kan også forsøke å verifisere manuelt.</BodyShort>
          <Form method="post">
            <input type="hidden" name="intent" value="verify_four_eyes" />
            <Button
              type="submit"
              size="small"
              variant="secondary"
              icon={<ArrowsCirclepathIcon aria-hidden />}
              loading={isVerifying}
            >
              Verifiser nå
            </Button>
          </Form>
        </VStack>
      )}
      {deployment.four_eyes_status === 'error' && (
        <VStack gap="space-8" marginBlock="space-8 space-0">
          {isAdmin &&
            verificationRun?.result &&
            (() => {
              const reason =
                (verificationRun.result as { approvalDetails?: { reason?: string } })?.approvalDetails?.reason ??
                'Ukjent'
              const shaMatch = reason.match(/Commit SHAs differ \(([a-f0-9]+)→([a-f0-9]+)\)/)
              const compareUrl =
                shaMatch && deployment.detected_github_owner && deployment.detected_github_repo_name
                  ? `https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${shaMatch[1]}...${shaMatch[2]}`
                  : null

              return (
                <BodyShort>
                  <strong>Årsak:</strong> {reason}
                  {compareUrl && (
                    <>
                      {' '}
                      <ExternalLink href={compareUrl}>Se compare på GitHub</ExternalLink>
                    </>
                  )}
                </BodyShort>
              )
            })()}
          <ReadMore header="Kan dette skyldes manglende GitHub App-tilgang?">
            <VStack gap="space-8">
              <BodyLong>
                Deployment Audit bruker en GitHub App for å hente commit-historikk og PR-data fra GitHub. Hvis appen
                ikke har tilgang til repoet{' '}
                <strong>
                  {deployment.detected_github_owner}/{deployment.detected_github_repo_name}
                </strong>
                , vil sammenligningen av commits feile med 404.
              </BodyLong>
              <BodyLong>
                <strong>Slik gir du appen tilgang:</strong>
              </BodyLong>
              <ol style={{ margin: 0, paddingLeft: '1.5rem' }}>
                <li>
                  Gå til{' '}
                  <ExternalLink
                    href={`https://github.com/organizations/${deployment.detected_github_owner}/settings/apps`}
                  >
                    GitHub → Organization settings → GitHub Apps
                  </ExternalLink>
                </li>
                <li>Finn appen «Pensjon Deployment Audit» og klikk «Configure»</li>
                <li>Under «Repository access», legg til repoet i listen over godkjente repos</li>
                <li>Kjør re-verifisering av dette deploymentet etterpå</li>
              </ol>
            </VStack>
          </ReadMore>
          {nearbyDeployments.length > 0 && (
            <ReadMore header={`Nærliggende deploys (±30 min, ${nearbyDeployments.length} stk)`}>
              <VStack gap="space-8">
                <BodyLong>
                  Følgende deploys til samme app skjedde innenfor 30 minutter. Hvis denne feilen skyldes en midlertidig
                  GitHub API-feil, kan en av disse ha samme commit og gyldig verifisering.
                </BodyLong>
                <Table size="small">
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
                      <Table.HeaderCell>Commit</Table.HeaderCell>
                      <Table.HeaderCell>Status</Table.HeaderCell>
                      <Table.HeaderCell>Deployer</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {mergeWithCurrentDeploy(nearbyDeployments, {
                      id: deployment.id,
                      commit_sha: deployment.commit_sha,
                      created_at: deployment.created_at,
                      four_eyes_status: deployment.four_eyes_status,
                      deployer_username: deployment.deployer_username,
                    }).map((nd) => (
                      <Table.Row
                        key={nd.id}
                        style={nd.isCurrent ? { background: 'var(--ax-bg-neutral-softA)' } : undefined}
                      >
                        <Table.DataCell>
                          {nd.isCurrent ? (
                            <BodyShort size="small" weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                              {new Date(nd.created_at).toLocaleString('no-NO', {
                                dateStyle: 'short',
                                timeStyle: 'medium',
                              })}
                            </BodyShort>
                          ) : (
                            <Link to={`${appUrl}/deployments/${nd.id}`} style={{ whiteSpace: 'nowrap' }}>
                              {new Date(nd.created_at).toLocaleString('no-NO', {
                                dateStyle: 'short',
                                timeStyle: 'medium',
                              })}
                            </Link>
                          )}
                        </Table.DataCell>
                        <Table.DataCell style={{ fontFamily: 'monospace' }}>
                          {nd.commit_sha?.substring(0, 7) ?? '—'}
                          {nd.isCurrent && (
                            <Tag variant="neutral" size="xsmall" style={{ marginLeft: '0.5rem' }}>
                              denne
                            </Tag>
                          )}
                          {!nd.isCurrent && nd.commit_sha === deployment.commit_sha && (
                            <Tag variant="info" size="xsmall" style={{ marginLeft: '0.5rem' }}>
                              same
                            </Tag>
                          )}
                        </Table.DataCell>
                        <Table.DataCell>
                          <Tag
                            variant={
                              isApprovedStatus(nd.four_eyes_status as FourEyesStatus)
                                ? 'success'
                                : nd.isCurrent
                                  ? 'error'
                                  : 'neutral'
                            }
                            size="xsmall"
                          >
                            {getFourEyesStatusLabel(nd.four_eyes_status)}
                          </Tag>
                        </Table.DataCell>
                        <Table.DataCell>
                          <UserName username={nd.deployer_username} userMappings={userMappings} link={false} />
                        </Table.DataCell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </VStack>
            </ReadMore>
          )}
        </VStack>
      )}
    </Alert>
  )
}
