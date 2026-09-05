import { Alert, BodyShort, Button, Dialog, List, VStack } from '@navikt/ds-react'
import { useState } from 'react'

export interface RepoAffectedApp {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
}

function otherApps(affectedApps: RepoAffectedApp[], currentAppId: number): RepoAffectedApp[] {
  return affectedApps.filter((app) => app.id !== currentAppId)
}

function appLabel(app: RepoAffectedApp): string {
  return `${app.team_slug}/${app.app_name} (${app.environment_name})`
}

export interface RepoScopeWarningProps {
  affectedApps: RepoAffectedApp[]
  currentAppId: number
}

export function RepoScopeWarning({ affectedApps, currentAppId }: RepoScopeWarningProps) {
  const others = otherApps(affectedApps, currentAppId)
  if (others.length === 0) return null

  return (
    <Alert variant="warning" size="small" inline={false}>
      <VStack gap="space-8">
        <BodyShort size="small">
          Denne innstillingen gjelder hele GitHub-repoet. {others.length}{' '}
          {others.length === 1 ? 'annen app' : 'andre apper'} deployes fra samme repo og får samme verdi:
        </BodyShort>
        <List size="small">
          {others.map((app) => (
            <List.Item key={app.id}>{appLabel(app)}</List.Item>
          ))}
        </List>
      </VStack>
    </Alert>
  )
}

export interface RepoScopeSaveButtonProps {
  affectedApps: RepoAffectedApp[]
  currentAppId: number
  formId: string
  settingLabel: string
  label?: string
}

export function RepoScopeSaveButton({
  affectedApps,
  currentAppId,
  formId,
  settingLabel,
  label = 'Lagre',
}: RepoScopeSaveButtonProps) {
  const [open, setOpen] = useState(false)
  const others = otherApps(affectedApps, currentAppId)

  if (others.length === 0) {
    return (
      <Button type="submit" size="small" variant="secondary">
        {label}
      </Button>
    )
  }

  return (
    <>
      <Button
        type="submit"
        size="small"
        variant="secondary"
        onClick={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Popup>
          <Dialog.Header>
            <Dialog.Title>Bekreft endring av {settingLabel}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <VStack gap="space-12">
              <BodyShort size="small">
                {settingLabel} lagres på GitHub-repoet, ikke på den enkelte appen. Endringen får virkning for alle{' '}
                {others.length + 1} appene som deployes fra dette repoet:
              </BodyShort>
              <List size="small">
                {affectedApps.map((app) => (
                  <List.Item key={app.id}>
                    {appLabel(app)}
                    {app.id === currentAppId ? ' — denne appen' : ''}
                  </List.Item>
                ))}
              </List>
            </VStack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="submit" form={formId} size="small" onClick={() => setOpen(false)}>
              Lagre for alle {others.length + 1} appene
            </Button>
            <Dialog.CloseTrigger>
              <Button type="button" variant="tertiary" size="small">
                Avbryt
              </Button>
            </Dialog.CloseTrigger>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog>
    </>
  )
}
