/**
 * Debug Verification Page (under Verification Diff)
 *
 * Same as debug-verify but with breadcrumbs showing verification-diff as parent.
 * Used when navigating from the verification-diff list.
 */

import { Alert, BodyShort, Box, Button, Heading, HStack, Switch, Tag, VStack } from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import { getDeploymentById } from '~/db/deployments.server'
import { getUserIdentity } from '~/lib/auth.server'
import { getFourEyesStatusLabel } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { type DebugVerificationResult, isVerificationDebugMode, runDebugVerification } from '~/lib/verification'
import type { Route } from './+types/$team.env.$env.app.$app.admin.verification-diff.$deploymentId'

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await getUserIdentity(request)
  if (!isVerificationDebugMode && user?.role !== 'admin') {
    throw new Response('Debug mode not enabled', { status: 403 })
  }

  const url = new URL(request.url)
  const useCache = url.searchParams.get('cache') !== 'false'

  const deploymentId = Number.parseInt(params.deploymentId, 10)
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
      params,
    }
  }

  if (!deployment.monitored_app_id) {
    return {
      deployment,
      error: 'Deployment er ikke koblet til en overvåket applikasjon',
      debugResult: null,
      useCache,
      params,
    }
  }

  try {
    const debugResult = await runDebugVerification(deploymentId, {
      commitSha: deployment.commit_sha,
      repository: `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
      environmentName: deployment.environment_name,
      baseBranch: deployment.default_branch || 'main',
      monitoredAppId: deployment.monitored_app_id,
      forceRefresh: !useCache,
    })

    return {
      deployment,
      debugResult,
      error: null,
      useCache,
      params,
    }
  } catch (error) {
    logger.error('Debug verification failed:', error)
    return {
      deployment,
      debugResult: null,
      error: error instanceof Error ? error.message : 'Ukjent feil ved verifisering',
      useCache,
      params,
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

export default function VerificationDiffDeploymentPage({ loaderData }: Route.ComponentProps) {
  const { deployment, debugResult, error, useCache, params } = loaderData
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

  const backUrl = `/team/${params.team}/env/${params.env}/app/${params.app}/admin/verification-diff`

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
            <Link to={`/team/${params.team}/env/${params.env}/app/${params.app}/deployments/${deployment.id}`}>
              <Button variant="secondary" size="small">
                Gå til deployment
              </Button>
            </Link>
            <Link to={backUrl}>
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

        {debugResult && <DebugResultView result={debugResult} />}
      </VStack>
    </Box>
  )
}

function DebugResultView({ result }: { result: DebugVerificationResult }) {
  const { existingStatus, fetchedData, newResult, comparison } = result

  const hasRealChange = comparison.statusChanged
  const onlyNameChange = comparison.statusEquivalent

  return (
    <VStack gap="space-6">
      <Box background={hasRealChange ? 'warning-soft' : 'success-soft'} padding="space-4" borderRadius="8">
        <VStack gap="space-2">
          <HStack gap="space-4" align="center">
            {hasRealChange ? (
              <>
                <Tag variant="warning">Endring oppdaget</Tag>
                <BodyShort>
                  Status: {getFourEyesStatusLabel(comparison.oldStatus || 'null')} →{' '}
                  {getFourEyesStatusLabel(comparison.newStatus)}
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

      <HStack gap="space-4" wrap>
        <Box background="neutral-soft" padding="space-4" borderRadius="8" style={{ flex: '1 1 300px' }}>
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Eksisterende status
            </Heading>
            <DataRow label="Status" value={existingStatus.status || 'null'} />
            <DataRow label="PR nummer" value={existingStatus.prNumber?.toString() || 'null'} />
            <DataRow label="Uverifiserte commits" value={existingStatus.unverifiedCommits?.length?.toString() || '0'} />
          </VStack>
        </Box>

        <Box background="neutral-soft" padding="space-4" borderRadius="8" style={{ flex: '1 1 300px' }}>
          <VStack gap="space-4">
            <Heading size="small" level="2">
              Nytt resultat (V2)
            </Heading>
            <DataRow label="Status" value={newResult.status} highlight={comparison.statusChanged} />
            <DataRow label="PR nummer" value={newResult.deployedPr?.number?.toString() || 'null'} />
            <DataRow label="Uverifiserte commits" value={newResult.unverifiedCommits.length.toString()} />
            <DataRow label="Approval method" value={newResult.approvalDetails.method || 'null'} />
            <DataRow label="Approval reason" value={newResult.approvalDetails.reason} />
          </VStack>
        </Box>
      </HStack>

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
          </VStack>

          <VStack gap="space-2">
            <Heading size="xsmall" level="3">
              Deployed PR
            </Heading>
            {fetchedData.deployedPr ? (
              <>
                <DataRow label="PR nummer" value={`#${fetchedData.deployedPr.number}`} />
                <DataRow label="Tittel" value={fetchedData.deployedPr.metadata.title} />
                <DataRow label="Forfatter" value={fetchedData.deployedPr.metadata.author?.username || 'ukjent'} />
                <DataRow label="Merged by" value={fetchedData.deployedPr.metadata.mergedBy?.username || 'null'} />
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
                    <BodyShort size="small">{review.username}</BodyShort>
                  </HStack>
                </Box>
              ))}
            </VStack>
          )}

          {newResult.unverifiedCommits.length > 0 && (
            <VStack gap="space-2">
              <Heading size="xsmall" level="3">
                Uverifiserte commits
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
