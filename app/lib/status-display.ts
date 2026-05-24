export function getFourEyesStatus(deployment: any): {
  text: string
  variant: 'success' | 'warning' | 'error' | 'info'
  description: string
} {
  // Map four_eyes_status to user-visible labels
  switch (deployment.four_eyes_status) {
    case 'approved':
    case 'approved_pr':
      return {
        text: 'Godkjent',
        variant: 'success',
        description: 'Dette deploymentet har blitt godkjent via en approved PR.',
      }
    case 'baseline':
      return {
        text: 'Baseline',
        variant: 'success',
        description: 'Første deployment for dette miljøet. Brukes som utgangspunkt for verifisering.',
      }
    case 'pending_baseline':
      return {
        text: 'Foreslått baseline',
        variant: 'warning',
        description: 'Første deployment for dette miljøet. Må godkjennes manuelt som baseline før videre verifisering.',
      }
    case 'no_changes':
      return {
        text: 'Ingen endringer',
        variant: 'success',
        description: 'Samme commit som forrige deployment.',
      }
    case 'unverified_commits':
      return {
        text: 'Ikke-godkjente commits',
        variant: 'error',
        description: 'Deploymentet inneholder endringer som ikke er verifisert av en annen person.',
      }
    case 'approved_pr_with_unreviewed':
      return {
        text: 'Ureviewed commits i merge',
        variant: 'error',
        description:
          'PR var godkjent, men det ble merget inn commits fra main som ikke har godkjenning. Se detaljer under.',
      }
    case 'legacy':
    case 'legacy_pending':
      return {
        text: deployment.four_eyes_status === 'legacy_pending' ? 'Legacy (venter)' : 'Legacy',
        variant: deployment.four_eyes_status === 'legacy_pending' ? 'warning' : 'success',
        description:
          deployment.four_eyes_status === 'legacy_pending'
            ? 'GitHub-data hentet. Venter på godkjenning fra en annen person.'
            : 'Dette deploymentet har ugyldig eller mangelfull data fra Nais API, som skyldes endringer i Nais sitt skjema.',
      }
    case 'manually_approved':
      return {
        text: 'Manuelt godkjent',
        variant: 'success',
        description: 'Dette deploymentet er manuelt godkjent med dokumentasjon i Slack.',
      }
    case 'implicitly_approved':
      return {
        text: 'Implisitt godkjent',
        variant: 'success',
        description:
          'Dette deploymentet er implisitt godkjent fordi den som merget PR-en verken opprettet PR-en eller har siste commit.',
      }
    case 'direct_push':
      return {
        text: 'Direct push',
        variant: 'warning',
        description: 'Dette var en direct push til main. Legg til Slack-lenke som bevis på review.',
      }
    case 'unauthorized_branch':
      return {
        text: 'Ikke på godkjent branch',
        variant: 'error',
        description:
          'Den deployede committen finnes ikke på appens konfigurerte default-branch. Dette kan skje hvis det deployes fra en feature-branch eller en annen branch enn den som er satt opp for verifisering.',
      }
    case 'unauthorized_repository':
      return {
        text: 'Ikke godkjent repository',
        variant: 'error',
        description:
          'Repositoryet som dette deploymentet kommer fra er ikke registrert som aktivt for denne appen. En team-administrator kan godkjenne repoet fra app-siden.',
      }
    case 'missing':
      return {
        text: 'Mangler godkjenning',
        variant: 'error',
        description: 'PR-en var ikke godkjent etter siste commit, eller godkjenningen kom før siste commit.',
      }
    case 'error':
      return {
        text: 'Feil ved verifisering',
        variant: 'error',
        description: 'Det oppstod en feil ved sjekk av GitHub.',
      }
    case 'pending':
      return {
        text: 'Venter på verifisering',
        variant: 'info',
        description:
          'Verifisering kjøres automatisk i bakgrunnen. NDA henter data fra GitHub og validerer om fire-øyne-prinsippet er oppfylt.',
      }
  }

  return {
    text: 'Ukjent status',
    variant: 'info',
    description: `Godkjenningsstatus kunne ikke fastslås (${deployment.four_eyes_status}).`,
  }
}

export function formatChangeSource(source: string): string {
  const labels: Record<string, string> = {
    verification: 'Verifisering',
    manual_approval: 'Manuell godkjenning',
    reverification: 'Reverifisering',
    sync: 'Synkronisering',
    legacy: 'Legacy',
    baseline_approval: 'Baseline godkjent',
    unknown: 'Ukjent',
  }
  return labels[source] || source
}
