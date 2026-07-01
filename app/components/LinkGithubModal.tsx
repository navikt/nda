import { Button, Modal, TextField, VStack } from '@navikt/ds-react'
import { forwardRef, useEffect, useState } from 'react'
import { Form } from 'react-router'

export interface LinkGithubModalProps {
  navIdent: string
  currentGithubUsername?: string | null
  isSubmitting: boolean
}

export const LinkGithubModal = forwardRef<HTMLDialogElement, LinkGithubModalProps>(
  ({ navIdent, currentGithubUsername, isSubmitting }, ref) => {
    const [githubUsername, setGithubUsername] = useState(currentGithubUsername ?? '')

    useEffect(() => {
      setGithubUsername(currentGithubUsername ?? '')
    }, [currentGithubUsername])

    return (
      <Modal
        ref={ref}
        header={{ heading: 'Knytt GitHub-konto' }}
        closeOnBackdropClick
        onClose={() => setGithubUsername(currentGithubUsername ?? '')}
      >
        <Modal.Body>
          <Form method="post" id="link-github-form">
            <input type="hidden" name="intent" value="link_github" />
            <input type="hidden" name="nav_ident" value={navIdent} />
            <VStack gap="space-16">
              <TextField
                label="GitHub brukernavn"
                name="github_username"
                value={githubUsername}
                onChange={(e) => setGithubUsername(e.target.value)}
                required
                autoComplete="off"
              />
            </VStack>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form="link-github-form" loading={isSubmitting}>
            Lagre
          </Button>
          <Button
            variant="secondary"
            type="button"
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

LinkGithubModal.displayName = 'LinkGithubModal'
