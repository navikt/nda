const TRIGGER_EVENT_LABELS: Record<string, string> = {
  push: 'Triggered via push',
  pull_request: 'Triggered via pull request',
  pull_request_target: 'Triggered via pull request target',
  workflow_dispatch: 'Manually triggered',
  workflow_call: 'Triggered by another workflow',
  workflow_run: 'Triggered by another workflow run',
  schedule: 'Triggered via schedule',
  release: 'Triggered via release',
  repository_dispatch: 'Triggered via repository dispatch',
  merge_group: 'Triggered via merge queue',
}

export function getWorkflowTriggerLabel(triggerEvent: string): string {
  return TRIGGER_EVENT_LABELS[triggerEvent] ?? `Triggered via ${triggerEvent.replaceAll('_', ' ')}`
}

export const MANUAL_TRIGGER_EVENTS: readonly string[] = ['workflow_dispatch', 'repository_dispatch']

export const GITHUB_TRIGGER_DOCS_URL =
  'https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows'

const TRIGGER_EVENT_DESCRIPTIONS: Record<string, string> = {
  push: 'Workflowen kjører når noen pusher en commit eller tag til repoet, inkludert på branches som ikke er merget til default branch.',
  pull_request:
    'Workflowen kjører ved aktivitet på en pull request (f.eks. opprettet, oppdatert, gjenåpnet). Kjører i kontekst av merge-branchen mellom PR og målbranch, og bruker begrenset GITHUB_TOKEN for PR-er fra forks.',
  pull_request_target:
    'Ligner pull_request, men kjører i kontekst av target-branchen (default branch) i stedet for merge-committen. Gir tilgang til secrets selv for PR-er fra forks, og regnes derfor som en potensiell sikkerhetsrisiko dersom koden fra PR-en kjøres direkte.',
  workflow_dispatch:
    'Manuell trigger — noen starter workflowen via GitHub UI, API-et eller GitHub CLI, eventuelt med egendefinerte input-parametere.',
  workflow_call:
    'Workflowen er satt opp som en gjenbrukbar workflow som kalles fra en annen workflow (reusable workflow), og arver samme event-kontekst som den kallende workflowen.',
  workflow_run:
    'Kjører når en annen navngitt workflow er requested eller completed. Brukes ofte for å kjøre privilegerte steg etter at en uprivilegert workflow (f.eks. fra en fork) er ferdig.',
  schedule:
    'Tidsstyrt trigger basert på cron-syntaks, kjører på siste commit på default branch. Kan bli forsinket ved høy last på GitHub Actions.',
  release: 'Kjører ved aktivitet knyttet til en release i repoet (f.eks. publisert, opprettet, slettet).',
  repository_dispatch:
    'Trigges via GitHub sitt API fra aktivitet utenfor GitHub, med en egendefinert event_type og valgfri client_payload.',
  merge_group:
    'Kjører når en pull request legges til i en merge-kø (merge queue), som en del av required status checks før merge.',
  unknown:
    'Trigger-informasjon mangler for disse leveransene — typisk eldre (legacy) deployments eller deployments som ikke er synkronisert med GitHub Actions-data ennå.',
}

export function getWorkflowTriggerDescription(triggerEvent: string): string | undefined {
  return TRIGGER_EVENT_DESCRIPTIONS[triggerEvent]
}

export function getAllKnownWorkflowTriggerEvents(): Array<{ event: string; label: string; description: string }> {
  return Object.entries(TRIGGER_EVENT_DESCRIPTIONS)
    .filter(([event]) => event !== 'unknown')
    .map(([event, description]) => ({ event, label: getWorkflowTriggerLabel(event), description }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))
}
