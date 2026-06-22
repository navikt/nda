export function ndaDeploymentUrl(
  teamSlug: string,
  environmentName: string,
  appName: string,
  deploymentId: number,
): string {
  return `https://nda.ansatt.nav.no/team/${teamSlug}/env/${environmentName}/app/${appName}/deployments/${deploymentId}`
}

export const MANUAL_APPROVALS_INTRO =
  'Følgende deployments er manuelt godkjent i NDA etter at leveransen ble gjennomført.'

export const DEVIATIONS_INTRO =
  'Følgende deployments ble registrert som avvik fra fire-øyne-prinsippet. Avvik krever oppfølging og dokumentasjon av årsak og tiltak.'

export const UNVERIFIED_COMMITS_INTRO_PDF =
  'Følgende deployments inneholdt commits som NDA ikke kunne bekrefte som fire-øyne-godkjent via GitHub. Deployments som er manuelt godkjent i NDA i etterkant er merket med godkjenner.'

export const UNVERIFIED_COMMITS_INTRO_EXCEL =
  'Følgende deployments inneholdt commits som NDA ikke kunne bekrefte som fire-øyne-godkjent via GitHub. Årsaken fremgår av kolonnen «Årsak». Deployments som er manuelt godkjent i NDA i etterkant er merket med godkjenner.'

export const UNVERIFIED_COMMITS_NOTE =
  'Merk: NDA startet å registrere flere commit-detaljer 30. januar 2026. Deployments utført før dette vil ikke vises her, men kan finnes i listen over godkjenninger i NDA.'
