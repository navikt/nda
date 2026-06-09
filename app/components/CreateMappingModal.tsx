import { Alert, BodyShort, Button, Label, Modal, TextField, VStack } from '@navikt/ds-react'
import { forwardRef, useState } from 'react'
import { Form } from 'react-router'
import type { GraphUserResult } from '~/lib/microsoft-graph.server'
import { formatDisplayNameNatural } from '~/lib/user-display'
import { UserSearch } from './UserSearch'

export interface CreateMappingModalProps {
  /** GitHub username (normal/admin flow) or route param value (self-service URL uses NAV-ident) */
  username: string
  /** Whether the logged-in user is creating a mapping for their own NAV-ident URL */
  canPrefillOwnMapping: boolean
  /** Whether the GitHub username field is editable (default: only in self-service) */
  githubEditable?: boolean
  /** Pre-filled NAV-ident for self-service flow */
  loggedInNavIdent?: string | null
  isSubmitting: boolean
  fieldErrors?: {
    github_username?: string
    nav_ident?: string
  }
  /** Override the form intent value (default: "create-mapping") */
  intent?: string
  /** Override the modal heading (default: "Opprett brukermapping") */
  heading?: string
  /** Override the form ID (default: "create-mapping-form") */
  formId?: string
  /** Modal width (passed to Modal component) */
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
      nav_email: '',
      nav_ident: canPrefillOwnMapping ? (loggedInNavIdent ?? '') : '',
    })

    const handleSelectUser = (user: GraphUserResult) => {
      setMappingFields({
        display_name: formatDisplayNameNatural(user.displayName),
        nav_email: user.email ?? '',
        nav_ident: user.navIdent ?? '',
      })
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
                  label="GitHub brukernavn (valgfritt)"
                  name="github_username"
                  defaultValue={canPrefillOwnMapping ? '' : username}
                  error={fieldErrors?.github_username}
                />
              ) : (
                <TextField label="GitHub brukernavn" value={username} error={fieldErrors?.github_username} disabled />
              )}
              {showUserSearch && (
                <UserSearch
                  label="Søk opp person"
                  description="Søk med navn, e-post eller NAV-ident for å fylle ut feltene under"
                  onSelect={() => {}}
                  onSelectUser={handleSelectUser}
                  onClear={() => setMappingFields({ display_name: '', nav_email: '', nav_ident: '' })}
                />
              )}
              {mappingFields.nav_ident && (
                <VStack gap="space-8">
                  <div>
                    <Label size="small">Navn</Label>
                    <BodyShort>{mappingFields.display_name || '–'}</BodyShort>
                  </div>
                  <div>
                    <Label size="small">Nav e-post</Label>
                    <BodyShort>{mappingFields.nav_email || '–'}</BodyShort>
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
              <TextField label="Slack member ID" name="slack_member_id" />
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
