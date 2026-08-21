import { Alert, BodyShort, Button, Label, Modal, TextField, VStack } from '@navikt/ds-react'
import { forwardRef, useEffect, useState } from 'react'
import { Form } from 'react-router'
import { useSlackMemberIdLookup } from '~/hooks/useSlackMemberIdLookup'
import type { NomUserResult } from '~/lib/nom.server'
import { formatDisplayNameNatural } from '~/lib/user-display'
import { SlackMemberIdField } from './SlackMemberIdField'
import { UserSearch } from './UserSearch'

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

    const slackLookup = useSlackMemberIdLookup()

    useEffect(() => {
      if (canPrefillOwnMapping && loggedInNavIdent) {
        slackLookup.lookup(loggedInNavIdent)
      }
    }, [canPrefillOwnMapping, loggedInNavIdent, slackLookup.lookup])

    const handleSelectUser = (user: NomUserResult) => {
      setMappingFields({
        display_name: formatDisplayNameNatural(user.displayName),
        nav_ident: user.navIdent ?? '',
      })
      if (user.navIdent) {
        slackLookup.lookup(user.navIdent)
      } else {
        slackLookup.reset()
      }
    }

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
                    slackLookup.reset()
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
              <SlackMemberIdField
                key={mappingFields.nav_ident}
                isLoading={slackLookup.isLoading}
                isAutoDetected={slackLookup.isAutoDetected}
                autoDetectedValue={slackLookup.slackMemberId}
              />
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
