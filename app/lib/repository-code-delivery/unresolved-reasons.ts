import type { UnresolvedReason } from '~/db/repository-code-delivery-establishment.server'

export const UNRESOLVED_REASON_LABELS: Record<UnresolvedReason, string> = {
  ancestry_unknown: 'Ancestry ukjent',
  ancestry_diverged: 'Ancestry avviker',
  ancestry_behind: 'Eldre enn forrige leveranse',
  source_unauthorized: 'Ikke godkjent kilde',
  source_unknown: 'Kilde ukjent',
}

export const UNRESOLVED_REASON_DESCRIPTIONS: Record<UnresolvedReason, string> = {
  ancestry_unknown: 'GitHub kunne ikke bekrefte historikken. Prøves på nytt automatisk.',
  ancestry_diverged: 'Commiten er ikke en videreføring av forrige leveranse.',
  ancestry_behind: 'Commiten er eldre enn forrige leveranse, for eksempel ved forsinket innlesing.',
  source_unauthorized: 'Commiten ligger ikke på standardbranchen, eller kommer fra et annet repository.',
  source_unknown: 'GitHub kunne ikke bekrefte kilden. Prøves på nytt automatisk.',
}

export const UNRESOLVED_REASONS = Object.keys(UNRESOLVED_REASON_LABELS) as UnresolvedReason[]
