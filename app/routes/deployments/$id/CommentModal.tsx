import { Button, Modal, Textarea, TextField, VStack } from '@navikt/ds-react'
import { type RefObject, useState } from 'react'
import { Form } from 'react-router'

export type CommentModalProps = {
  modalRef: RefObject<HTMLDialogElement | null>
}

export function CommentModal({ modalRef }: CommentModalProps) {
  const [commentText, setCommentText] = useState('')
  const [slackLink, setSlackLink] = useState('')

  return (
    <Modal ref={modalRef} header={{ heading: 'Legg til kommentar' }} closeOnBackdropClick>
      <Modal.Body>
        <Form method="post" onSubmit={() => modalRef.current?.close()}>
          <input type="hidden" name="intent" value="add_comment" />
          <VStack gap="space-16">
            <Textarea
              label="Kommentar"
              name="comment_text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              description="F.eks. forklaring av direct push eller andre notater"
            />
            <TextField
              label="Slack-lenke (valgfritt)"
              name="slack_link"
              value={slackLink}
              onChange={(e) => setSlackLink(e.target.value)}
              description="Lenke til Slack-tråd med code review dokumentasjon"
            />
          </VStack>
          <Modal.Footer>
            <Button type="submit">Legg til</Button>
            <Button variant="secondary" type="button" onClick={() => modalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Form>
      </Modal.Body>
    </Modal>
  )
}
