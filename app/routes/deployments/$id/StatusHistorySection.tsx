import { DownloadIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { type FourEyesStatus, isApprovedStatus } from '~/lib/four-eyes-status'
import { formatChangeSource } from '~/lib/status-display'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type StatusHistorySectionProps = {
  statusHistory: LoaderData['statusHistory']
  deployment: LoaderData['deployment']
  previousDeployment: LoaderData['previousDeployment']
  nearbyDeployments: LoaderData['nearbyDeployments']
  verificationRun: LoaderData['verificationRun']
  isAdmin: LoaderData['isAdmin']
}
export function StatusHistorySection({
  statusHistory,
  deployment,
  previousDeployment,
  nearbyDeployments,
  verificationRun,
  isAdmin,
}: StatusHistorySectionProps) {
  return (
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
  )
}
