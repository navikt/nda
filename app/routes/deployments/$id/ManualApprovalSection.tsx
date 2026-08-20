import { ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Textarea, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import type { getFourEyesStatus } from '~/lib/status-display'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type ManualApprovalSectionProps = {
  status: ReturnType<typeof getFourEyesStatus>
  deployment: LoaderData['deployment']
  previousDeploymentForDiff: LoaderData['previousDeploymentForDiff']
  isCurrentUserInvolved: LoaderData['isCurrentUserInvolved']
  involvementReason: LoaderData['involvementReason']
  capabilities: LoaderData['capabilities']
}

export function ManualApprovalSection({
  status,
  deployment,
  previousDeploymentForDiff,
  isCurrentUserInvolved,
  involvementReason,
  capabilities,
}: ManualApprovalSectionProps) {
  const [approvalReason, setApprovalReason] = useState('')
  const [approvalSlackLink, setApprovalSlackLink] = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)

  return (
    <Box background="warning-moderate" padding="space-24" borderRadius="8">
      <VStack gap="space-16">
        <Heading size="small" level="3">
          <ExclamationmarkTriangleIcon aria-hidden /> Krever manuell godkjenning
        </Heading>
        <BodyShort>
          Dette deploymentet har status "{status.text}" og krever manuell godkjenning for å oppfylle
          fire-øyne-prinsippet.
          {previousDeploymentForDiff?.commit_sha && deployment.commit_sha && (
            <>
              {' '}
              <ExternalLink
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeploymentForDiff.commit_sha}...${deployment.commit_sha}`}
              >
                Se endringer på GitHub
              </ExternalLink>
            </>
          )}
        </BodyShort>

        {isCurrentUserInvolved ? (
          <Alert variant="warning">
            <Heading size="xsmall" level="4" spacing>
              Du kan ikke godkjenne dette deploymentet
            </Heading>
            <BodyShort>{involvementReason}</BodyShort>
            <BodyShort style={{ marginTop: 'var(--ax-space-8)' }}>
              Fire-øyne-prinsippet krever at en annen person godkjenner.
            </BodyShort>
          </Alert>
        ) : !capabilities.canApprove ? (
          <Alert variant="info">
            <BodyShort>Du har ikke tilgang til å godkjenne denne deploymenten.</BodyShort>
          </Alert>
        ) : !showApprovalForm ? (
          <Button variant="primary" onClick={() => setShowApprovalForm(true)}>
            Godkjenn manuelt
          </Button>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="manual_approval" />
            <VStack gap="space-16">
              <TextField
                label="Slack-lenke (valgfritt)"
                name="slack_link"
                value={approvalSlackLink}
                onChange={(e) => setApprovalSlackLink(e.target.value)}
                description="Lenke til Slack-tråd hvor kode-review er dokumentert"
                size="small"
              />
              <Textarea
                label="Begrunnelse (valgfritt)"
                name="reason"
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                description="F.eks: 'Hotfix reviewet i Slack av kollega'"
                size="small"
                rows={2}
              />
              <HStack gap="space-8">
                <Button type="submit" variant="primary" size="small">
                  Godkjenn
                </Button>
                <Button type="button" variant="secondary" size="small" onClick={() => setShowApprovalForm(false)}>
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
