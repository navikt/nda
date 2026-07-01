import { CheckmarkCircleIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HGrid, ProgressBar, TextField, VStack } from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, useNavigation } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { getVerificationStats } from '~/db/deployments.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { logger } from '~/lib/logger.server'
import { verifyDeploymentsWithLock } from '~/lib/sync'
import type { Route } from './+types/verify'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiser deployments - NDA' }]
}

export async function loader({ url }: Route.LoaderArgs) {
  const appId = url.searchParams.get('app')

  const stats = await getVerificationStats(appId ? parseInt(appId, 10) : undefined)

  return {
    appId: appId ? parseInt(appId, 10) : null,
    stats,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const limit = Number(formData.get('limit')) || 50
  const appIdParam = formData.get('app_id')

  try {
    logger.info(`🔍 Starting batch verification (limit: ${limit})`)

    if (appIdParam) {
      const appId = parseInt(appIdParam as string, 10)
      const lockResult = await verifyDeploymentsWithLock(appId, limit)

      if (lockResult.locked || !lockResult.result) {
        return {
          success: null,
          error: 'En annen verifisering kjører allerede for denne applikasjonen. Prøv igjen om litt.',
          result: null,
        }
      }

      const result = lockResult.result
      return {
        success: `Verifisert ${result.verified} deployments. ${result.failed > 0 ? `${result.failed} feilet.` : ''} ${result.skipped > 0 ? `${result.skipped} hoppet over.` : ''}`,
        error: null,
        result,
      }
    }

    const apps = await getAllMonitoredApplications()
    let totalVerified = 0
    let totalFailed = 0
    let totalSkipped = 0
    let lockedCount = 0

    for (const app of apps) {
      const lockResult = await verifyDeploymentsWithLock(app.id, Math.ceil(limit / apps.length))

      if (lockResult.locked) {
        lockedCount++
        continue
      }

      if (lockResult.result) {
        totalVerified += lockResult.result.verified
        totalFailed += lockResult.result.failed
        totalSkipped += lockResult.result.skipped
      }
    }

    const lockedMsg = lockedCount > 0 ? ` ${lockedCount} app(er) hadde allerede en kjørende verifisering.` : ''
    return {
      success: `Verifisert ${totalVerified} deployments. ${totalFailed > 0 ? `${totalFailed} feilet.` : ''} ${totalSkipped > 0 ? `${totalSkipped} hoppet over.` : ''}${lockedMsg}`,
      error: null,
      result: { verified: totalVerified, failed: totalFailed, skipped: totalSkipped },
    }
  } catch (error) {
    logger.error('Batch verification error:', error)

    if (error instanceof Error && error.message.includes('rate limit')) {
      return {
        success: null,
        error: 'GitHub rate limit nådd! Vent 1 time før du prøver igjen.',
        result: null,
      }
    }

    return {
      success: null,
      error: error instanceof Error ? error.message : 'Kunne ikke verifisere deployments',
      result: null,
    }
  }
}

export default function DeploymentsVerify({ loaderData, actionData }: Route.ComponentProps) {
  const { appId, stats } = loaderData
  const navigation = useNavigation()
  const isVerifying = navigation.state === 'submitting'

  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!isVerifying) {
      setProgress(0)
      return
    }

    const formData = navigation.formData
    const limit = formData ? Number(formData.get('limit')) || 50 : 50
    const estimatedSeconds = limit * 1

    let elapsed = 0
    const interval = setInterval(() => {
      elapsed += 1
      const percentage = Math.min((elapsed / estimatedSeconds) * 100, 95)
      setProgress(percentage)
    }, 1000)

    return () => clearInterval(interval)
  }, [isVerifying, navigation.formData])

  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="large" spacing>
          Batch GitHub-verifisering{appId ? ' for applikasjon' : ''}
        </Heading>
        <BodyShort textColor="subtle">
          Verifiser godkjenningsstatus for flere deployments samtidig. Dette kaller GitHub API og bruker rate limit.
        </BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
          {actionData.result && (
            <BodyShort size="small">
              Verifisert: {actionData.result.verified} • Feilet: {actionData.result.failed} • Hoppet over:{' '}
              {actionData.result.skipped}
            </BodyShort>
          )}
        </Alert>
      )}

      <ActionAlert data={actionData} />

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading level="2" size="small">
            Status
          </Heading>
          <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
            <Box padding="space-16" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Totalt deployments
                </BodyShort>
                <Heading level="3" size="medium">
                  {stats.total}
                </Heading>
              </VStack>
            </Box>
            <Box padding="space-16" borderRadius="8" background="sunken" data-color="warning">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Trenger verifisering
                </BodyShort>
                <Heading level="3" size="medium">
                  {stats.needsVerification}
                </Heading>
              </VStack>
            </Box>
            <Box padding="space-16" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Pending
                </BodyShort>
                <Heading level="3" size="medium">
                  {stats.pending}
                </Heading>
              </VStack>
            </Box>
            <Box padding="space-16" borderRadius="8" background="sunken" data-color="danger">
              <VStack gap="space-4">
                <BodyShort size="small" textColor="subtle">
                  Error
                </BodyShort>
                <Heading level="3" size="medium">
                  {stats.error}
                </Heading>
              </VStack>
            </Box>
          </HGrid>
        </VStack>
      </Box>

      <Alert variant="info">
        <Heading level="2" size="small" spacing>
          Om GitHub Rate Limits
        </Heading>
        <BodyShort>
          GitHub har en rate limit på 5000 requests per time for autentiserte requests. Hver verifisering bruker 2-3
          requests. Hvis du når limit, må du vente 1 time.
        </BodyShort>
      </Alert>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <Form method="post">
          <VStack gap="space-24">
            {appId && <input type="hidden" name="app_id" value={appId} />}
            <TextField
              name="limit"
              label="Antall deployments å verifisere"
              description="Maks antall som verifiseres i denne kjøringen"
              defaultValue="50"
              type="number"
              min="1"
              max="500"
              style={{ maxWidth: '300px' }}
            />

            <div>
              <Button
                type="submit"
                icon={<CheckmarkCircleIcon aria-hidden />}
                disabled={isVerifying || stats.needsVerification === 0}
              >
                {isVerifying ? 'Verifiserer...' : 'Start verifisering'}
              </Button>
            </div>
          </VStack>
        </Form>
      </Box>

      {isVerifying && (
        <Box padding="space-32" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16" align="center">
            <div style={{ width: '100%', maxWidth: '600px' }}>
              <ProgressBar value={progress} size="medium" aria-label="Verifiserings-fremdrift" />
            </div>
            <BodyShort textColor="subtle">Verifiserer deployments... {Math.round(progress)}%</BodyShort>
            <BodyShort size="small" textColor="subtle">
              Dette kan ta litt tid. Ikke lukk vinduet.
            </BodyShort>
          </VStack>
        </Box>
      )}
    </VStack>
  )
}
