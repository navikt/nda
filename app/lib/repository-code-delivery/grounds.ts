import type { EstablishmentGrounds } from '~/db/repository-code-delivery-establishment.server'

export type AncestryStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

export interface GroundsEvidence {
  headSha: string
  baseSha: string | null
  onApprovedBranch: boolean | null
  ancestry: AncestryStatus | null | 'not_required'
}

export function decideEstablishmentGrounds(evidence: GroundsEvidence): EstablishmentGrounds {
  const { headSha, baseSha, onApprovedBranch, ancestry } = evidence
  if (onApprovedBranch !== true) return { confirmed: false, reason: 'source_unauthorized', headSha }
  if (ancestry === 'not_required') return { confirmed: true, baseSha, headSha }
  if (ancestry === null) return { confirmed: false, reason: 'ancestry_unknown', headSha }
  if (ancestry !== 'ahead') return { confirmed: false, reason: 'ancestry_diverged', headSha }
  return { confirmed: true, baseSha, headSha }
}
