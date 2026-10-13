import { describe, expect, it } from 'vitest'
import {
  UNRESOLVED_REASON_DESCRIPTIONS,
  UNRESOLVED_REASON_LABELS,
  UNRESOLVED_REASONS,
} from '~/lib/repository-code-delivery/unresolved-reasons'

describe('unresolved reasons', () => {
  it('lists every reason with a label and a description', () => {
    expect(UNRESOLVED_REASONS.sort()).toEqual([
      'ancestry_behind',
      'ancestry_diverged',
      'ancestry_unknown',
      'source_unauthorized',
      'source_unknown',
    ])
    for (const reason of UNRESOLVED_REASONS) {
      expect(UNRESOLVED_REASON_LABELS[reason]).toBeTruthy()
      expect(UNRESOLVED_REASON_DESCRIPTIONS[reason]).toBeTruthy()
    }
  })
})
