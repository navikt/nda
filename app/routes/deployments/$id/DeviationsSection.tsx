import { ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import type { RefObject } from 'react'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
} from '~/lib/deviation-constants'
import { getUserDisplayName } from '~/lib/user-display'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type DeviationsSectionProps = {
  deviations: LoaderData['deviations']
  capabilities: LoaderData['capabilities']
  userMappings: LoaderData['userMappings']
  deviationDialogRef: RefObject<HTMLDialogElement | null>
}

export function DeviationsSection({
  deviations,
  capabilities,
  userMappings,
  deviationDialogRef,
}: DeviationsSectionProps) {
  const getUserDisplay = (githubUsername: string | undefined | null) => getUserDisplayName(githubUsername, userMappings)

  return (
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
  )
}
