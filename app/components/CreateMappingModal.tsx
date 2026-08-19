import { Alert, BodyShort, Button, Label, Modal, TextField, VStack } from '@navikt/ds-react'
import { forwardRef, useEffect, useState } from 'react'
import { Form, useFetcher } from 'react-router'
import type { GraphUserResult } from '~/lib/microsoft-graph.server'
import { formatDisplayNameNatural } from '~/lib/user-display'
import { UserSearch } from './UserSearch'

interface SlackLookupResponse {
  slackMemberId: string | null
}

export interface CreateMappingModalProps {
  username: string
  canPrefillOwnMapping: boolean
  githubEditable?: boolean
  loggedInNavIdent?: string | null
  isSubmitting: boolean
  fieldErrors?: {
    github_username?: string
    nav_ident?: string
  }
  intent?: string
  heading?: string
  formId?: string
  width?: 'medium' | 'small' | number | `${number}${string}`
}

export const CreateMappingModal = forwardRef<HTMLDialogElement, CreateMappingModalProps>(
  (
    {
      username,
      canPrefillOwnMapping,
      githubEditable,
      loggedInNavIdent,
      isSubmitting,
      fieldErrors,
      intent = 'create-mapping',
      heading = 'Opprett brukermapping',
      formId = 'create-mapping-form',
      width,
    },
    ref,
  ) => {
    const isGithubEditable = githubEditable ?? canPrefillOwnMapping
    const showUserSearch = !canPrefillOwnMapping

    const [mappingFields, setMappingFields] = useState({
      display_name: '',
      nav_ident: canPrefillOwnMapping ? (loggedInNavIdent ?? '') : '',
    })

    const slackLookupFetcher = useFetcher<SlackLookupResponse>()
    const [autoSlackMemberId, setAutoSlackMemberId] = useState<string | null>(null)

    useEffect(() => {
      if (slackLookupFetcher.data) {
        setAutoSlackMemberId(slackLookupFetcher.data.slackMemberId ?? null)
      }
    }, [slackLookupFetcher.data])

    useEffect(() => {
      if (canPrefillOwnMapping && loggedInNavIdent) {
        setAutoSlackMemberId(null)
        slackLookupFetcher.load(`/api/users/slack-lookup?nav_ident=${encodeURIComponent(loggedInNavIdent)}`)
      }
    }, [canPrefillOwnMapping, loggedInNavIdent, slackLookupFetcher.load])

    const handleSelectUser = (user: GraphUserResult) => {
      setMappingFields({
        display_name: formatDisplayNameNatural(user.displayName),
        nav_ident: user.navIdent ?? '',
      })
      setAutoSlackMemberId(null)
      if (user.navIdent) {
        slackLookupFetcher.load(`/api/users/slack-lookup?nav_ident=${encodeURIComponent(user.navIdent)}`)
      }
    }

    const isSlackLookupInProgress = slackLookupFetcher.state !== 'idle'
    const isSlackMemberIdAutoDetected = !isSlackLookupInProgress && !!autoSlackMemberId

    return (
      <Modal ref={ref} header={{ heading }} width={width}>
        <Modal.Body>
          <Form method="post" id={formId}>
            <input type="hidden" name="intent" value={intent} />
            {!isGithubEditable && <input type="hidden" name="github_username" value={username} />}
            <VStack gap="space-16">
              {isGithubEditable ? (
                <TextField
                  label="GitHub brukernavn"
                  name="github_username"
                  defaultValue={canPrefillOwnMapping ? '' : username}
                  error={fieldErrors?.github_username}
                  required
                />
              ) : (
                <TextField label="GitHub brukernavn" value={username} error={fieldErrors?.github_username} disabled />
              )}
              {showUserSearch && (
                <UserSearch
                  label="Søk opp person"
                  description="Søk med navn eller NAV-ident for å fylle ut feltene under"
                  onSelect={() => {}}
                  onSelectUser={handleSelectUser}
                  onClear={() => {
                    setMappingFields({ display_name: '', nav_ident: '' })
                    setAutoSlackMemberId(null)
                  }}
                />
              )}
              {mappingFields.nav_ident && (
                <VStack gap="space-8">
                  <div>
                    <Label size="small">Navn</Label>
                    <BodyShort>{mappingFields.display_name || '–'}</BodyShort>
                  </div>
                  <div>
                    <Label size="small">Nav-ident</Label>
                    <BodyShort>{mappingFields.nav_ident}</BodyShort>
                  </div>
                </VStack>
              )}
              <input type="hidden" name="nav_ident" value={mappingFields.nav_ident} />
              {fieldErrors?.nav_ident && (
                <Alert variant="error" size="small">
                  {fieldErrors.nav_ident}
                </Alert>
              )}
              <TextField
                key={isSlackMemberIdAutoDetected ? 'auto' : 'manual'}
                label="Slack member ID"
                name={isSlackMemberIdAutoDetected ? undefined : 'slack_member_id'}
                value={isSlackMemberIdAutoDetected ? (autoSlackMemberId ?? '') : undefined}
                defaultValue={isSlackMemberIdAutoDetected ? undefined : ''}
                disabled={isSlackMemberIdAutoDetected}
                readOnly={isSlackMemberIdAutoDetected}
                description={
                  isSlackLookupInProgress
                    ? 'Slår opp Slack-ID automatisk …'
                    : isSlackMemberIdAutoDetected
                      ? 'Funnet automatisk basert på e-postadresse i Slack'
                      : undefined
                }
              />
              {isSlackMemberIdAutoDetected && (
                <input type="hidden" name="slack_member_id" value={autoSlackMemberId ?? ''} />
              )}
            </VStack>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form={formId} loading={isSubmitting}>
            Lagre
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (typeof ref === 'object' && ref?.current) ref.current.close()
            }}
          >
            Avbryt
          </Button>
        </Modal.Footer>
      </Modal>
    )
  },
)

CreateMappingModal.displayName = 'CreateMappingModal'
