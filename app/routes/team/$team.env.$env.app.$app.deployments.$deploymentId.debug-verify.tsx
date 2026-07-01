import { Alert, BodyShort, Box, Button, Heading, HStack, Switch, Tag, VStack } from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { getDeploymentById } from '~/db/deployments.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { getUserIdentity } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import { getUserDisplayName, serializeUserLookups } from '~/lib/user-display'
import { type DebugVerificationResult, isVerificationDebugMode, runDebugVerification } from '~/lib/verification'
import type { Route } from './+types/$team.env.$env.app.$app.deployments.$deploymentId.debug-verify'

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const user = await getUserIdentity(request)
  if (!isVerificationDebugMode && user?.role !== 'admin') {
    throw new Response('Debug mode not enabled', { status: 403 })
  }

  const useCache = url.searchParams.get('cache') !== 'false'

  const deploymentId = parseInt(params.deploymentId, 10)
  if (Number.isNaN(deploymentId)) {
    throw new Response('Invalid deployment ID', { status: 400 })
  }

  const deployment = await getDeploymentById(deploymentId)
  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 })
  }

  if (!deployment.commit_sha || !deployment.detected_github_owner || !deployment.detected_github_repo_name) {
    return {
      deployment,
      error: 'Deployment mangler nødvendig data for verifisering',
      debugResult: null,
      useCache,
    }
  }

  if (!deployment.monitored_app_id) {
    return {
      deployment,
      error: 'Deployment er ikke koblet til en overvåket applikasjon',
      debugResult: null,
      useCache,
    }
  }

  if (!deployment.default_branch) {
    return {
      deployment,
      error:
        'Kan ikke verifisere: default_branch er ikke satt for denne appen. Auto-sync fyller inn verdien innen 5 minutter.',
      debugResult: null,
      useCache,
    }
  }

  try {
    const debugResult = await runDebugVerification(deploymentId, {
      commitSha: deployment.commit_sha,
      repository: `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
      environmentName: deployment.environment_name,
      baseBranch: deployment.default_branch,
      monitoredAppId: deployment.monitored_app_id,
      forceRefresh: !useCache,
    })

    const usernames = new Set<string>()
    const fetchedData = debugResult.fetchedData
    if (fetchedData?.deployedPr) {
      if (fetchedData.deployedPr.metadata.author?.username)
        usernames.add(fetchedData.deployedPr.metadata.author.username)
      if (fetchedData.deployedPr.metadata.mergedBy?.username)
        usernames.add(fetchedData.deployedPr.metadata.mergedBy.username)
      for (const review of fetchedData.deployedPr.reviews) {
        if (review.username) usernames.add(review.username)
      }
    }
    for (const nearby of debugResult.nearbyDeployments) {
      if (nearby.deployerUsername) usernames.add(nearby.deployerUsername)
    }
    for (const pr of debugResult.mergedPullRequestsWindow.pullRequests) {
      if (pr.authorUsername) usernames.add(pr.authorUsername)
      if (pr.mergedByUsername) usernames.add(pr.mergedByUsername)
    }
    const mappingUsernames = Array.from(usernames)
    const mappings = mappingUsernames.length > 0 ? await getGithubUserLookups(mappingUsernames) : new Map()

    return {
      deployment,
      debugResult,
      error: null,
      useCache,
      userMappings: serializeUserLookups(mappings),
    }
  } catch (error) {
    logger.error('Debug verification failed:', error)
    return {
      deployment,
      debugResult: null,
      error: error instanceof Error ? error.message : 'Ukjent feil ved verifisering',
      useCache,
    }
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Debug Verifisering' }]
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function DebugVerifyPage({ loaderData }: Route.ComponentProps) {
  const { deployment, debugResult, error, useCache } = loaderData
  const userMappings =
    'userMappings' in loaderData ? (loaderData.userMappings as Record<string, { display_name: string | null }>) : {}
  const [searchParams, setSearchParams] = useSearchParams()

  const handleCacheToggle = (checked: boolean) => {
    const newParams = new URLSearchParams(searchParams)
    if (checked) {
      newParams.delete('cache')
    } else {
      newParams.set('cache', 'false')
    }
    setSearchParams(newParams)
  }

  const handleExport = () => {
    if (debugResult) {
      const filename = `debug-verify-${deployment.id}-${new Date().toISOString().slice(0, 10)}.json`
      downloadJson(debugResult, filename)
    }
  }

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <HStack justify="space-between" align="center">
          <VStack gap="space-2">
            <Heading size="large" level="1">
              🔬 Debug Verifisering
            </Heading>
            <BodyShort>
              Deployment #{deployment.id} - {deployment.commit_sha?.substring(0, 7)}
            </BodyShort>
          </VStack>
          <HStack gap="space-4" align="center">
            <Switch checked={useCache} onChange={(e) => handleCacheToggle(e.target.checked)}>
              Bruk cached data
            </Switch>
            {debugResult && (
              <Button variant="secondary" size="small" onClick={handleExport}>
                📥 Eksporter JSON
              </Button>
            )}
            <Link
              to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}`}
            >
              <Button variant="secondary" size="small">
                ← Tilbake
              </Button>
            </Link>
          </HStack>
        </HStack>

        <Alert variant="warning">
          Debug-modus: Resultat lagres IKKE til databasen. Data fra GitHub lagres som snapshots.
        </Alert>

        {error && (
          <Alert variant="error">
            <Heading size="small" level="2" spacing>
              Feil ved verifisering
            </Heading>
            <BodyShort>{error}</BodyShort>
          </Alert>
        )}

        {debugResult && <DebugResultView result={debugResult} userMappings={userMappings} />}
      </VStack>
    </Box>
  )
}

function DebugResultView({
  result,
  userMappings,
}: {
  result: DebugVerificationResult
  userMappings: Record<string, { display_name: string | null }>
}) {
  const { existingStatus, fetchedData, nearbyDeployments, newResult, comparison } = result
  const resolveUsername = (username: string | undefined | null) =>
    getUserDisplayName(username, userMappings) ?? username ?? 'ukjent'
  const formatMergedPrClassification = (
    classification: DebugVerificationResult['mergedPullRequestsWindow']['pullRequests'][number]['classification'],
  ) => {
    switch (classification) {
      case 'deployed_as_current_pr':
        return { label: 'Levert (nåværende PR)', variant: 'success' as const }
      case 'deployed_as_nearby_pr':
        return { label: 'Levert (nearby PR)', variant: 'info' as const }
      case 'deployed_by_commit_sha':
        return { label: 'Levert (commit SHA)', variant: 'neutral' as const }
      case 'not_observed_in_deployments':
        return { label: 'Ikke observert i deploys', variant: 'warning' as const }
    }
  }

  const hasRealChange = comparison.statusChanged
  const onlyNameChange = comparison.statusEquivalent

  return (
    <VStack gap="space-6">
      {/* Comparison Summary */}
      <Box background={hasRealChange ? 'warning-soft' : 'success-soft'} padding="space-4" borderRadius="8">
        <VStack gap="space-2">
          <HStack gap="space-4" align="center">
            {hasRealChange ? (
              <>
                <Tag variant="warning">Endring oppdaget</Tag>
                <BodyShort>
                  Status: {comparison.oldStatus || 'null'} → {comparison.newStatus}
                </BodyShort>
              </>
            ) : (
              <>
                <Tag variant="success">Ingen endring</Tag>
                <BodyShort>Gammelt og nytt resultat er identisk</BodyShort>
              </>
            )}
          </HStack>
          {onlyNameChange && (
            <BodyShort size="small" textColor="subtle">
              ℹ️ Status-navnene er forskjellige ({comparison.oldStatus} → {comparison.newStatus}), men betyr det samme.
              Det nye systemet bruker forenklede status-navn.
            </BodyShort>
          )}
        </VStack>
      </Box>

      {/* Side-by-side comparison */}
      <HStack gap="space-4" wrap>
        {/* Existing Status */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8" style={{ flex: '1 1 300px' }}>
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Eksisterende status
            </Heading>
            <DataRow label="Status" value={existingStatus.status || 'null'} />
            <DataRow label="PR nummer" value={existingStatus.prNumber?.toString() || 'null'} />
            <DataRow
              label="Ikke-godkjente commits"
              value={existingStatus.unverifiedCommits?.length?.toString() || '0'}
            />
          </VStack>
        </Box>

        {/* New Result */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8" style={{ flex: '1 1 300px' }}>
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Nytt resultat (V2)
            </Heading>
            <DataRow label="Status" value={newResult.status} highlight={comparison.statusChanged} />
            <DataRow label="PR nummer" value={newResult.deployedPr?.number?.toString() || 'null'} />
            <DataRow label="Ikke-godkjente commits" value={newResult.unverifiedCommits.length.toString()} />
            <DataRow label="Approval method" value={newResult.approvalDetails.method || 'null'} />
            <DataRow label="Approval reason" value={newResult.approvalDetails.reason} />
          </VStack>
        </Box>
      </HStack>

      {/* Fetched Data Details */}
      <Box background="neutral-soft" padding="space-4" borderRadius="8">
        <VStack gap="space-4">
          <Heading size="small" level="2">
            Hentet data fra GitHub
          </Heading>

          <VStack gap="space-2">
            <Heading size="xsmall" level="3">
              Deployment info
            </Heading>
            <DataRow label="Commit SHA" value={fetchedData.commitSha} />
            <DataRow label="Repository" value={fetchedData.repository} />
            <DataRow label="Environment" value={fetchedData.environmentName} />
            <DataRow label="Base branch" value={fetchedData.baseBranch} />
            {fetchedData.branchMismatch && (
              <DataRow
                label="⚠️ Branch mismatch"
                value={`Forventet '${fetchedData.branchMismatch.expectedBranch}', fant PR-er på '${fetchedData.branchMismatch.detectedBranches.join(
                  ', ',
                )}' (PR ${fetchedData.branchMismatch.prNumbers.map((n) => `#${n}`).join(', ')})`}
              />
            )}
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall" level="3">
              Deployed PR
            </Heading>
            {fetchedData.deployedPr ? (
              <>
                <DataRow label="PR nummer" value={`#${fetchedData.deployedPr.number}`} />
                <DataRow label="Tittel" value={fetchedData.deployedPr.metadata.title} />
                <DataRow label="Forfatter" value={resolveUsername(fetchedData.deployedPr.metadata.author?.username)} />
                <DataRow
                  label="Merged by"
                  value={resolveUsername(fetchedData.deployedPr.metadata.mergedBy?.username)}
                />
                <DataRow label="Reviews" value={fetchedData.deployedPr.reviews.length.toString()} />
                <DataRow label="Commits" value={fetchedData.deployedPr.commits.length.toString()} />
              </>
            ) : (
              <BodyShort>Ingen PR funnet for denne commit</BodyShort>
            )}
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall" level="3">
              Commits mellom deployments
            </Heading>
            <DataRow label="Antall commits" value={fetchedData.commitsBetween.length.toString()} />
            {fetchedData.commitsBetween.slice(0, 5).map((commit) => (
              <Box key={commit.sha} padding="space-2" background="raised" borderRadius="4">
                <BodyShort size="small">
                  {commit.sha.substring(0, 7)} - {commit.message.split('\n')[0].substring(0, 60)}
                  {commit.pr ? ` (PR #${commit.pr.number})` : ' (ingen PR)'}
                </BodyShort>
              </Box>
            ))}
            {fetchedData.commitsBetween.length > 5 && (
              <BodyShort size="small">... og {fetchedData.commitsBetween.length - 5} til</BodyShort>
            )}
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall" level="3">
              Nearby deploys (±30 min)
            </Heading>
            <DataRow label="Antall nearby deploys" value={nearbyDeployments.length.toString()} />
            {nearbyDeployments.length === 0 ? (
              <BodyShort>Ingen nearby deploys funnet</BodyShort>
            ) : (
              nearbyDeployments.map((nearby) => (
                <Box key={nearby.id} padding="space-2" background="raised" borderRadius="4">
                  <VStack gap="space-1">
                    <BodyShort size="small">
                      #{nearby.id} - {new Date(nearby.createdAt).toLocaleString('nb-NO')}
                    </BodyShort>
                    <BodyShort size="small">
                      SHA: {(nearby.commitSha ?? 'null').substring(0, 7)} | Status: {nearby.fourEyesStatus ?? 'null'} |
                      PR: {nearby.githubPrNumber ? `#${nearby.githubPrNumber}` : 'null'}
                    </BodyShort>
                    <BodyShort size="small">
                      Deployer: {resolveUsername(nearby.deployerUsername)} | Tittel: {nearby.title ?? 'null'}
                    </BodyShort>
                  </VStack>
                </Box>
              ))
            )}
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall" level="3">
              Merged PR-er (±30 min)
            </Heading>
            <DataRow
              label="Tidsvindu"
              value={
                result.mergedPullRequestsWindow.windowStart && result.mergedPullRequestsWindow.windowEnd
                  ? `${new Date(result.mergedPullRequestsWindow.windowStart).toLocaleString('nb-NO')} → ${new Date(
                      result.mergedPullRequestsWindow.windowEnd,
                    ).toLocaleString('nb-NO')}`
                  : 'ikke tilgjengelig'
              }
            />
            <DataRow
              label="Antall merged PR-er"
              value={result.mergedPullRequestsWindow.summary.totalMergedPrs.toString()}
            />
            <DataRow
              label="Levert via nåværende PR"
              value={result.mergedPullRequestsWindow.summary.deliveredAsCurrentPr.toString()}
            />
            <DataRow
              label="Levert via nearby PR"
              value={result.mergedPullRequestsWindow.summary.deliveredAsNearbyPr.toString()}
            />
            <DataRow
              label="Levert via commit SHA"
              value={result.mergedPullRequestsWindow.summary.deliveredByCommitSha.toString()}
            />
            <DataRow
              label="Ikke observert i deploys"
              value={result.mergedPullRequestsWindow.summary.notObservedInDeployments.toString()}
            />
            {result.mergedPullRequestsWindow.fetchError && (
              <BodyShort size="small" style={{ color: 'var(--a-text-danger)' }}>
                Klarte ikke hente merged PR-vindu: {result.mergedPullRequestsWindow.fetchError}
              </BodyShort>
            )}
            {result.mergedPullRequestsWindow.pullRequests.length === 0 ? (
              <BodyShort>Ingen merged PR-er funnet i tidsvinduet</BodyShort>
            ) : (
              result.mergedPullRequestsWindow.pullRequests.map((pr) => {
                const classification = formatMergedPrClassification(pr.classification)
                return (
                  <Box key={pr.number} padding="space-2" background="raised" borderRadius="4">
                    <VStack gap="space-1">
                      <HStack gap="space-2" align="center">
                        <Tag variant={classification.variant} size="small">
                          {classification.label}
                        </Tag>
                        <BodyShort size="small">
                          <ExternalLink href={pr.htmlUrl}>#{pr.number}</ExternalLink> -{' '}
                          {new Date(pr.mergedAt).toLocaleString('nb-NO')}
                        </BodyShort>
                      </HStack>
                      <BodyShort size="small">Tittel: {pr.title}</BodyShort>
                      <BodyShort size="small">
                        Forfatter: {resolveUsername(pr.authorUsername)} | Merged by:{' '}
                        {resolveUsername(pr.mergedByUsername)}
                      </BodyShort>
                      <BodyShort size="small">
                        merge_commit_sha: {pr.mergeCommitSha?.substring(0, 7) ?? 'null'} | head_sha:{' '}
                        {pr.headSha.substring(0, 7)} | deploy matches:{' '}
                        {pr.matchedDeploymentIds.length > 0 ? pr.matchedDeploymentIds.join(', ') : 'ingen'}
                      </BodyShort>
                    </VStack>
                  </Box>
                )
              })
            )}
          </VStack>

          {fetchedData.deployedPr && fetchedData.deployedPr.reviews.length > 0 && (
            <VStack gap="space-2">
              <Heading size="xsmall" level="3">
                Reviews
              </Heading>
              {fetchedData.deployedPr.reviews.map((review) => (
                <Box
                  key={`${review.username}-${review.submittedAt}`}
                  padding="space-2"
                  background="raised"
                  borderRadius="4"
                >
                  <HStack gap="space-2">
                    <Tag variant={review.state === 'APPROVED' ? 'success' : 'neutral'} size="small">
                      {review.state}
                    </Tag>
                    <BodyShort size="small">{resolveUsername(review.username)}</BodyShort>
                  </HStack>
                </Box>
              ))}
            </VStack>
          )}

          {newResult.unverifiedCommits.length > 0 && (
            <VStack gap="space-2">
              <Heading size="xsmall" level="3">
                Ikke-godkjente commits
              </Heading>
              {newResult.unverifiedCommits.map((commit) => (
                <Box key={commit.sha} padding="space-2" background="danger-soft" borderRadius="4">
                  <VStack gap="space-1">
                    <BodyShort size="small" weight="semibold">
                      {commit.sha.substring(0, 7)} - {commit.message.substring(0, 50)}
                    </BodyShort>
                    <BodyShort size="small">
                      Grunn: {commit.reason} | PR: {commit.prNumber || 'ingen'}
                    </BodyShort>
                  </VStack>
                </Box>
              ))}
            </VStack>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}

function DataRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <HStack gap="space-2">
      <BodyShort size="small" weight="semibold" style={{ minWidth: '140px' }}>
        {label}:
      </BodyShort>
      <BodyShort size="small" style={{ color: highlight ? 'var(--a-text-danger)' : undefined }}>
        {value}
      </BodyShort>
    </HStack>
  )
}
