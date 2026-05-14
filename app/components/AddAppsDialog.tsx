import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  HStack,
  Modal,
  Select,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { forwardRef, useMemo, useState } from 'react'
import { Form } from 'react-router'
import {
  IMPLICIT_APPROVAL_MODE_DESCRIPTIONS,
  IMPLICIT_APPROVAL_MODE_LABELS,
  IMPLICIT_APPROVAL_MODES,
} from '~/lib/verification/types'

export type AddableApp = {
  team_slug: string
  environment_name: string
  app_name: string
  /** null = app is not yet monitored (will be created). number = existing monitored_app id (just linked). */
  monitored_id: number | null
}

interface AddAppsDialogProps {
  addableApps: AddableApp[]
  naisCatalogFailed: boolean
  isSubmitting: boolean
}

export const AddAppsDialog = forwardRef<HTMLDialogElement, AddAppsDialogProps>(function AddAppsDialog(
  { addableApps, naisCatalogFailed, isSubmitting },
  ref,
) {
  const [search, setSearch] = useState('')
  const currentYear = new Date().getFullYear()

  const hasNewApps = addableApps.some((app) => app.monitored_id === null)

  const searchLower = search.toLowerCase()
  const filteredApps = useMemo(
    () =>
      search
        ? addableApps.filter(
            (app) =>
              app.app_name.toLowerCase().includes(searchLower) ||
              app.team_slug.toLowerCase().includes(searchLower) ||
              app.environment_name.toLowerCase().includes(searchLower),
          )
        : addableApps,
    [addableApps, search, searchLower],
  )

  const appsByNaisTeam = useMemo(() => {
    const grouped = new Map<string, AddableApp[]>()
    for (const app of filteredApps) {
      const group = grouped.get(app.team_slug) ?? []
      group.push(app)
      grouped.set(app.team_slug, group)
    }
    return grouped
  }, [filteredApps])

  const closeModal = () => {
    if (typeof ref === 'object' && ref?.current) ref.current.close()
  }

  const refValue = (app: AddableApp) =>
    app.monitored_id !== null
      ? `id:${app.monitored_id}`
      : `new:${app.team_slug}|${app.environment_name}|${app.app_name}`

  return (
    <Modal ref={ref} header={{ heading: 'Legg til applikasjoner' }} closeOnBackdropClick width="640px">
      <Modal.Body>
        <Form
          method="post"
          id="add-apps-form"
          onSubmit={() => {
            closeModal()
          }}
        >
          <input type="hidden" name="intent" value="add_apps" />
          <VStack gap="space-12">
            {naisCatalogFailed && (
              <Alert variant="error" size="small">
                Kunne ikke hente Nais-katalogen akkurat nå. Last siden på nytt om litt for å se tilgjengelige
                applikasjoner.
              </Alert>
            )}
            <BodyShort size="small" textColor="subtle">
              Lista viser Nais-applikasjoner som ikke allerede er koblet til teamet. Apper merket «Ny i overvåking»
              opprettes automatisk når du krysser dem av og lagrer.
            </BodyShort>
            {hasNewApps && (
              <>
                <TextField
                  label="Startår for revisjon"
                  description="Gjelder kun apper som er nye i overvåking"
                  size="small"
                  name="audit_start_year"
                  type="number"
                  defaultValue={String(currentYear)}
                  htmlSize={6}
                  min={2000}
                  max={currentYear + 1}
                  required
                />
                <Select
                  label="Implisitt godkjenning for nye apper"
                  name="implicit_approval_mode"
                  size="small"
                  defaultValue="off"
                  style={{ maxWidth: '300px' }}
                >
                  {IMPLICIT_APPROVAL_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {IMPLICIT_APPROVAL_MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
                <BodyShort size="small" textColor="subtle">
                  <strong>{IMPLICIT_APPROVAL_MODE_LABELS.dependabot_only}:</strong>{' '}
                  {IMPLICIT_APPROVAL_MODE_DESCRIPTIONS.dependabot_only}.
                  <br />
                  <strong>{IMPLICIT_APPROVAL_MODE_LABELS.all}:</strong> {IMPLICIT_APPROVAL_MODE_DESCRIPTIONS.all}.
                </BodyShort>
              </>
            )}
            <TextField
              label="Søk etter applikasjon"
              hideLabel
              placeholder="Søk etter applikasjon, team eller miljø..."
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            <Box style={{ maxHeight: '400px', overflowY: 'auto' }} paddingInline="space-4" paddingBlock="space-4">
              {filteredApps.length === 0 ? (
                <BodyShort size="small" textColor="subtle">
                  {search
                    ? 'Ingen applikasjoner matcher søket.'
                    : naisCatalogFailed
                      ? 'Ingen applikasjoner å vise — Nais-katalogen er utilgjengelig.'
                      : addableApps.length === 0
                        ? 'Alle Nais-applikasjoner er allerede koblet til teamet.'
                        : 'Ingen applikasjoner funnet i Nais.'}
                </BodyShort>
              ) : (
                <VStack gap="space-16">
                  {[...appsByNaisTeam.entries()].map(([naisTeam, apps]) => (
                    <CheckboxGroup key={naisTeam} legend={naisTeam} size="small">
                      {apps.map((app) => (
                        <Checkbox
                          key={`${app.team_slug}|${app.environment_name}|${app.app_name}`}
                          name="app_ref"
                          value={refValue(app)}
                        >
                          <HStack gap="space-8" align="center" wrap>
                            <span>{app.app_name}</span>
                            <BodyShort as="span" size="small" textColor="subtle">
                              ({app.environment_name})
                            </BodyShort>
                            {app.monitored_id === null && (
                              <Tag size="xsmall" variant="info">
                                Ny i overvåking
                              </Tag>
                            )}
                          </HStack>
                        </Checkbox>
                      ))}
                    </CheckboxGroup>
                  ))}
                </VStack>
              )}
            </Box>
          </VStack>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button type="submit" form="add-apps-form" size="small" loading={isSubmitting}>
          Legg til valgte
        </Button>
        <Button variant="tertiary" size="small" type="button" onClick={closeModal}>
          Avbryt
        </Button>
      </Modal.Footer>
    </Modal>
  )
})
