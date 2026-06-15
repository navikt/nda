import { Button, Modal, Radio, RadioGroup, Select, Textarea, TextField, VStack } from '@navikt/ds-react'
import { type RefObject, useState } from 'react'
import { Form } from 'react-router'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
} from '~/lib/deviation-constants'

export type DeviationModalProps = {
  modalRef: RefObject<HTMLDialogElement | null>
}

export function DeviationModal({ modalRef }: DeviationModalProps) {
  const [deviationReason, setDeviationReason] = useState('')

  return (
    <Modal ref={modalRef} header={{ heading: 'Registrer avvik' }} closeOnBackdropClick>
      <Modal.Body>
        <Form
          method="post"
          onSubmit={() => {
            modalRef.current?.close()
            setDeviationReason('')
          }}
        >
          <input type="hidden" name="intent" value="register_deviation" />
          <VStack gap="space-16">
            <TextField
              label="Type brudd"
              name="deviation_breach_type"
              description="Hvilken lov, forskrift, rutine eller regel er brutt?"
            />
            <Textarea
              label="Beskrivelse"
              name="deviation_reason"
              value={deviationReason}
              onChange={(e) => setDeviationReason(e.target.value)}
              description="Beskriv avviket, hva som skjedde og konsekvensene"
            />
            <RadioGroup legend="Intensjon" name="deviation_intent" defaultValue="unknown">
              {Object.entries(DEVIATION_INTENT_LABELS).map(([value, label]) => (
                <Radio key={value} value={value}>
                  {label}
                </Radio>
              ))}
            </RadioGroup>
            <RadioGroup legend="Alvorlighetsgrad" name="deviation_severity" defaultValue="medium">
              {Object.entries(DEVIATION_SEVERITY_LABELS).map(([value, label]) => (
                <Radio key={value} value={value}>
                  {label}
                </Radio>
              ))}
            </RadioGroup>
            <Select label="Oppfølgingsansvarlig" name="deviation_follow_up_role">
              <option value="">Velg rolle</option>
              {Object.entries(DEVIATION_FOLLOW_UP_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </VStack>
          <Modal.Footer>
            <Button type="submit" variant="danger">
              Registrer avvik
            </Button>
            <Button variant="secondary" type="button" onClick={() => modalRef.current?.close()}>
              Avbryt
            </Button>
          </Modal.Footer>
        </Form>
      </Modal.Body>
    </Modal>
  )
}
