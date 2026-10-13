import type { EstablishmentGrounds } from '~/db/repository-code-delivery-establishment.server'

export type AncestryStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

export interface GroundsEvidence {
  headSha: string
  baseSha: string | null
  identity: 'match' | 'mismatch' | 'unknown'
  onApprovedBranch: boolean | null
  ancestry: AncestryStatus | null | 'not_required'
}

export function decideEstablishmentGrounds(evidence: GroundsEvidence): EstablishmentGrounds {
  const { headSha, baseSha, identity, onApprovedBranch, ancestry } = evidence
  if (identity === 'mismatch') return { confirmed: false, reason: 'source_unauthorized', headSha }
  if (identity === 'unknown') return { confirmed: false, reason: 'source_unknown', headSha }
  if (onApprovedBranch === null) return { confirmed: false, reason: 'source_unknown', headSha }
  if (!onApprovedBranch) return { confirmed: false, reason: 'source_unauthorized', headSha }
  if (ancestry === 'not_required') return { confirmed: true, baseSha, headSha }
  if (ancestry === null) return { confirmed: false, reason: 'ancestry_unknown', headSha }
  if (ancestry === 'behind') return { confirmed: false, reason: 'ancestry_behind', headSha }
  if (ancestry !== 'ahead') return { confirmed: false, reason: 'ancestry_diverged', headSha }
  return { confirmed: true, baseSha, headSha }
}
