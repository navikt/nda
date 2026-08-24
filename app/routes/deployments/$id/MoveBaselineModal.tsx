import { Alert, BodyShort, Button, Modal, Textarea, VStack } from '@navikt/ds-react'
import { type RefObject, useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import { BaselineInfo } from '~/components/BaselineInfo'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type MoveBaselineModalProps = {
  modalRef: RefObject<HTMLDialogElement | null>
  anchors: NonNullable<LoaderData['baselineMove']>['anchors']
}

export function MoveBaselineModal({ modalRef, anchors }: MoveBaselineModalProps) {
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
    <Modal ref={modalRef} header={{ heading: 'Flytt baseline hit' }} closeOnBackdropClick onClose={handleClose}>
      <Modal.Body>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="move_baseline" />
          <VStack gap="space-16">
            <BaselineInfo />
            <BodyShort>
              Dette deploymentet blir ny baseline for applikasjonen. Disse senere deploymentene nedgraderes og
              re-verifiseres automatisk mot den nye baselinen:
            </BodyShort>
            <VStack gap="space-4" as="ul" style={{ margin: 0, paddingInlineStart: 'var(--ax-space-20)' }}>
              {anchors.map((anchor) => (
                <BodyShort as="li" key={anchor.id} size="small">
                  {anchor.four_eyes_status === 'baseline' ? 'Baseline' : 'Foreslått baseline'} fra{' '}
                  {new Date(anchor.created_at).toLocaleString('no-NO', { dateStyle: 'medium', timeStyle: 'short' })}
                </BodyShort>
              ))}
            </VStack>
            <Textarea
              label="Begrunnelse"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              description="Forklar hvorfor baseline flyttes bakover i tid"
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
              Flytt baseline
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                modalRef.current?.close()
                handleClose()
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
