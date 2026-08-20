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
