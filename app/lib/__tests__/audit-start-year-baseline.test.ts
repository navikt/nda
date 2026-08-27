import { describe, expect, it } from 'vitest'
import { type BaselineMarker, computeBaselineRecomputePlan } from '../audit-start-year-baseline'

describe('computeBaselineRecomputePlan', () => {
  it('is a no-op when the new first deployment is already the current baseline marker', () => {
    const marker: BaselineMarker = { id: 1, four_eyes_status: 'baseline' }
    const plan = computeBaselineRecomputePlan(marker, marker)

    expect(plan.promote).toBeNull()
    expect(plan.demote).toBeNull()
  })

  it('is a no-op when the new first deployment is already the current pending_baseline marker', () => {
    const marker: BaselineMarker = { id: 1, four_eyes_status: 'pending_baseline' }
    const plan = computeBaselineRecomputePlan(marker, marker)

    expect(plan.promote).toBeNull()
    expect(plan.demote).toBeNull()
  })

  it('promotes the new first deployment and demotes an old pending_baseline marker to pending', () => {
    const oldMarker: BaselineMarker = { id: 1, four_eyes_status: 'pending_baseline' }
    const newFirst: BaselineMarker = { id: 2, four_eyes_status: 'approved_pr' }

    const plan = computeBaselineRecomputePlan(oldMarker, newFirst)

    expect(plan.promote).toEqual({ id: 2, fromStatus: 'approved_pr' })
    expect(plan.demote).toEqual({ id: 1, fromStatus: 'pending_baseline', toStatus: 'pending' })
  })

  it('promotes the new first deployment and demotes an old approved baseline to manually_approved', () => {
    const oldMarker: BaselineMarker = { id: 1, four_eyes_status: 'baseline' }
    const newFirst: BaselineMarker = { id: 2, four_eyes_status: 'unverified_commits' }

    const plan = computeBaselineRecomputePlan(oldMarker, newFirst)

    expect(plan.promote).toEqual({ id: 2, fromStatus: 'unverified_commits' })
    expect(plan.demote).toEqual({ id: 1, fromStatus: 'baseline', toStatus: 'manually_approved' })
  })

  it('does not re-promote a new first deployment that is already pending_baseline', () => {
    const oldMarker: BaselineMarker = { id: 1, four_eyes_status: 'baseline' }
    const newFirst: BaselineMarker = { id: 2, four_eyes_status: 'pending_baseline' }

    const plan = computeBaselineRecomputePlan(oldMarker, newFirst)

    expect(plan.promote).toBeNull()
    expect(plan.demote).toEqual({ id: 1, fromStatus: 'baseline', toStatus: 'manually_approved' })
  })

  it('does not downgrade a new first deployment that is already baseline', () => {
    const oldMarker: BaselineMarker = { id: 1, four_eyes_status: 'pending_baseline' }
    const newFirst: BaselineMarker = { id: 2, four_eyes_status: 'baseline' }

    const plan = computeBaselineRecomputePlan(oldMarker, newFirst)

    expect(plan.promote).toBeNull()
    expect(plan.demote).toEqual({ id: 1, fromStatus: 'pending_baseline', toStatus: 'pending' })
  })

  it('promotes the first deployment when there was no previous marker at all', () => {
    const newFirst: BaselineMarker = { id: 2, four_eyes_status: 'approved_pr' }

    const plan = computeBaselineRecomputePlan(null, newFirst)

    expect(plan.promote).toEqual({ id: 2, fromStatus: 'approved_pr' })
    expect(plan.demote).toBeNull()
  })

  it('demotes the old marker when no eligible deployment exists in the new scope', () => {
    const oldMarker: BaselineMarker = { id: 1, four_eyes_status: 'pending_baseline' }

    const plan = computeBaselineRecomputePlan(oldMarker, null)

    expect(plan.promote).toBeNull()
    expect(plan.demote).toEqual({ id: 1, fromStatus: 'pending_baseline', toStatus: 'pending' })
  })

  it('does nothing when there is no old marker and no new first deployment', () => {
    const plan = computeBaselineRecomputePlan(null, null)

    expect(plan.promote).toBeNull()
    expect(plan.demote).toBeNull()
  })

  it('does not demote an old marker with a status other than pending_baseline or baseline', () => {
    const oldMarker: BaselineMarker = { id: 1, four_eyes_status: 'manually_approved' }
    const newFirst: BaselineMarker = { id: 2, four_eyes_status: 'approved_pr' }

    const plan = computeBaselineRecomputePlan(oldMarker, newFirst)

    expect(plan.promote).toEqual({ id: 2, fromStatus: 'approved_pr' })
    expect(plan.demote).toBeNull()
  })
})
