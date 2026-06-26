import { Alert, Button, Modal, Textarea, VStack } from '@navikt/ds-react'
import { type RefObject, useEffect, useState } from 'react'
import { useFetcher } from 'react-router'

export type ResetVerificationModalProps = {
  modalRef: RefObject<HTMLDialogElement | null>
}

export function ResetVerificationModal({ modalRef }: ResetVerificationModalProps) {
  const [reason, setReason] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fetcher = useFetcher<{ success?: string; error?: string }>()

  useEffect(() => {
    if (fetcher.data?.success) {
      modalRef.current?.close()
      setReason('')
      setSubmitError(null)
    } else if (fetcher.data?.error) {
      setSubmitError(fetcher.data.error)
    }
  }, [fetcher.data, modalRef])

  function handleClose() {
    setReason('')
    setSubmitError(null)
  }

  return (
    <Modal ref={modalRef} header={{ heading: 'Tilbakestill verifisering' }} closeOnBackdropClick onClose={handleClose}>
      <Modal.Body>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="reset_verification" />
          <VStack gap="space-16">
            <Textarea
              label="Begrunnelse"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              description="Forklar hvorfor verifiseringsstatusen skal tilbakestilles slik at deploymenten kan re-verifiseres"
              minRows={3}
              required
            />
            {submitError && <Alert variant="error">{submitError}</Alert>}
          </VStack>
          <Modal.Footer>
            <Button
              type="submit"
              variant="danger"
              disabled={!reason.trim() || fetcher.state === 'submitting'}
              loading={fetcher.state === 'submitting'}
            >
              Tilbakestill
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                modalRef.current?.close()
                setReason('')
                setSubmitError(null)
              }}
            >
              Avbryt
            </Button>
          </Modal.Footer>
        </fetcher.Form>
      </Modal.Body>
    </Modal>
  )
}
