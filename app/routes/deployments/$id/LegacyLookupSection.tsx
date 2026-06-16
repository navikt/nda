import { ClockIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form } from 'react-router'
import { getUserDisplayName } from '~/lib/user-display'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type LegacyLookupSectionProps = {
  actionData: Route.ComponentProps['actionData']
  userMappings: LoaderData['userMappings']
}

export function LegacyLookupSection({ actionData, userMappings }: LegacyLookupSectionProps) {
  const [showLegacyForm, setShowLegacyForm] = useState(false)
  const [legacySearchType, setLegacySearchType] = useState<'sha' | 'pr'>('sha')
  const [legacySearchValue, setLegacySearchValue] = useState('')
  const [legacySlackLink, setLegacySlackLink] = useState('')

  const resetLegacyForm = () => {
    setShowLegacyForm(false)
    setLegacySearchType('sha')
    setLegacySearchValue('')
    setLegacySlackLink('')
  }

  const getUserDisplay = (githubUsername: string | undefined | null) => getUserDisplayName(githubUsername, userMappings)

  return (
    <Box background="info-moderate" padding="space-24" borderRadius="8">
      <VStack gap="space-16">
        <Heading size="small" level="3">
          <ClockIcon aria-hidden /> Legacy deployment - hent data fra GitHub
        </Heading>
        <BodyShort>
          Søk opp data fra GitHub ved hjelp av commit SHA eller PR-nummer. Tidspunktet må være innenfor 30 minutter av
          deployment-tidspunktet. En annen person må deretter godkjenne.
        </BodyShort>

        {actionData?.error && showLegacyForm && <Alert variant="error">{actionData.error}</Alert>}
        {actionData?.success && showLegacyForm && <Alert variant="success">{actionData.success}</Alert>}

        {!showLegacyForm ? (
          <Button variant="primary" onClick={() => setShowLegacyForm(true)}>
            Hent fra GitHub
          </Button>
        ) : actionData?.legacyLookup ? (
          // Show preview of looked up data
          <VStack gap="space-16">
            <Alert variant={actionData.legacyLookup.isWithinThreshold ? 'success' : 'warning'}>
              <Heading size="xsmall" level="4">
                {actionData.legacyLookup.isWithinThreshold ? 'Data funnet!' : 'Data funnet, men tidspunkt avviker'}
              </Heading>
              <BodyShort>
                Tidsforskjell: {actionData.legacyLookup.timeDifferenceMinutes} minutter
                {!actionData.legacyLookup.isWithinThreshold && ' (over 30 min grense)'}
              </BodyShort>
            </Alert>

            <Box background="default" padding="space-16" borderRadius="4">
              <VStack gap="space-8">
                <Detail>
                  <strong>Commit:</strong> {actionData.legacyLookup.commitSha?.substring(0, 7)}
                </Detail>
                <Detail>
                  <strong>Melding:</strong> {actionData.legacyLookup.commitMessage}
                </Detail>
                <Detail>
                  <strong>Forfatter:</strong> {getUserDisplay(actionData.legacyLookup.commitAuthor)}
                </Detail>
                {actionData.legacyLookup.mergedBy && (
                  <Detail>
                    <strong>Merget av:</strong> {getUserDisplay(actionData.legacyLookup.mergedBy)}
                  </Detail>
                )}
                {actionData.legacyLookup.prNumber && (
                  <>
                    <Detail>
                      <strong>PR:</strong> #{actionData.legacyLookup.prNumber} - {actionData.legacyLookup.prTitle}
                    </Detail>
                    <Detail>
                      <strong>Godkjennere:</strong>{' '}
                      {actionData.legacyLookup.reviewers
                        ?.filter((r: { state: string }) => r.state === 'APPROVED')
                        .map((r: { username: string }) => getUserDisplay(r.username))
                        .join(', ') || 'Ingen'}
                    </Detail>
                  </>
                )}
              </VStack>
            </Box>

            <HStack gap="space-8">
              <Form method="post" onSubmit={resetLegacyForm}>
                <input type="hidden" name="intent" value="confirm_legacy_lookup" />
                <input type="hidden" name="slack_link" value={actionData.legacyLookup.slackLink} />
                <input type="hidden" name="commit_sha" value={actionData.legacyLookup.commitSha || ''} />
                <input type="hidden" name="commit_message" value={actionData.legacyLookup.commitMessage || ''} />
                <input type="hidden" name="commit_author" value={actionData.legacyLookup.commitAuthor || ''} />
                <input type="hidden" name="pr_number" value={actionData.legacyLookup.prNumber || ''} />
                <input type="hidden" name="pr_title" value={actionData.legacyLookup.prTitle || ''} />
                <input type="hidden" name="pr_url" value={actionData.legacyLookup.prUrl || ''} />
                <input type="hidden" name="pr_author" value={actionData.legacyLookup.prAuthor || ''} />
                <input type="hidden" name="merged_by" value={actionData.legacyLookup.mergedBy || ''} />
                <input
                  type="hidden"
                  name="pr_merged_at"
                  value={
                    actionData.legacyLookup.prMergedAt ? new Date(actionData.legacyLookup.prMergedAt).toISOString() : ''
                  }
                />
                <input type="hidden" name="reviewers" value={JSON.stringify(actionData.legacyLookup.reviewers || [])} />
                <Button type="submit" variant="primary" size="small">
                  Bekreft og lagre
                </Button>
              </Form>
              <Button variant="secondary" size="small" onClick={resetLegacyForm}>
                Avbryt
              </Button>
            </HStack>
          </VStack>
        ) : (
          // Show search form
          <Form method="post">
            <input type="hidden" name="intent" value="lookup_legacy_github" />
            <VStack gap="space-16">
              <TextField
                label="Slack-lenke"
                name="slack_link"
                value={legacySlackLink}
                onChange={(e) => setLegacySlackLink(e.target.value)}
                description="Lenke til Slack-melding for denne deployen"
                size="small"
                required
              />
              <HStack gap="space-8" align="end">
                <div>
                  <BodyShort size="small" weight="semibold" spacing>
                    Søk på
                  </BodyShort>
                  <HStack gap="space-8">
                    <Button
                      type="button"
                      variant={legacySearchType === 'sha' ? 'primary' : 'secondary'}
                      size="small"
                      onClick={() => setLegacySearchType('sha')}
                    >
                      Commit SHA
                    </Button>
                    <Button
                      type="button"
                      variant={legacySearchType === 'pr' ? 'primary' : 'secondary'}
                      size="small"
                      onClick={() => setLegacySearchType('pr')}
                    >
                      PR-nummer
                    </Button>
                  </HStack>
                </div>
              </HStack>
              <input type="hidden" name="search_type" value={legacySearchType} />
              <TextField
                label={legacySearchType === 'sha' ? 'Commit SHA' : 'PR-nummer'}
                name="search_value"
                value={legacySearchValue}
                onChange={(e) => setLegacySearchValue(e.target.value)}
                description={legacySearchType === 'sha' ? 'Full eller delvis SHA' : 'F.eks. 1234'}
                size="small"
                required
              />
              <HStack gap="space-8">
                <Button type="submit" variant="primary" size="small">
                  Søk på GitHub
                </Button>
                <Button type="button" variant="secondary" size="small" onClick={resetLegacyForm}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        )}
      </VStack>
    </Box>
  )
}
