import { ArrowsCirclepathIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, HStack, ProgressBar, VStack } from '@navikt/ds-react'

export interface GithubVerificationProgressProps {
  verified: number
  pending: number
  total: number
  verifyLimitPerCycle: number
  syncIntervalMs: number
}

function formatEta(minutes: number): string {
  const totalMinutes = Math.round(minutes)
  if (totalMinutes < 1) return 'under 1 min'
  if (totalMinutes < 60) return `~${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const rest = totalMinutes % 60
  return rest > 0 ? `~${hours} t ${rest} min` : `~${hours} t`
}

export function GithubVerificationProgress({
  verified,
  pending,
  total,
  verifyLimitPerCycle,
  syncIntervalMs,
}: GithubVerificationProgressProps) {
  if (total === 0 || pending === 0) return null

  const percentage = Math.round((verified / total) * 100)
  const remainingCycles = Math.ceil(pending / verifyLimitPerCycle)
  const etaMinutes = remainingCycles * (syncIntervalMs / 60_000)

  return (
    <Alert variant="info">
      <VStack gap="space-12">
        <HStack gap="space-8" align="center">
          <ArrowsCirclepathIcon aria-hidden fontSize="1.25rem" />
          <BodyShort weight="semibold">Innledende GitHub-verifisering pågår</BodyShort>
        </HStack>
        <BodyShort size="small">
          {verified} av {total} deployments er verifisert ({percentage}%). {pending} gjenstår og verifiseres fortløpende
          i puljer på {verifyLimitPerCycle} — estimert ferdig om {formatEta(etaMinutes)}.
        </BodyShort>
        <div style={{ maxWidth: '480px', width: '100%' }}>
          <ProgressBar value={percentage} size="small" aria-label="Verifiserings-fremdrift" />
        </div>
      </VStack>
    </Alert>
  )
}
