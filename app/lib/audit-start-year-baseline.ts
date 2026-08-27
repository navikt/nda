import type { FourEyesStatus } from './four-eyes-status'

export interface BaselineMarker {
  id: number
  four_eyes_status: FourEyesStatus
}

export interface BaselineRecomputePlan {
  promote: { id: number; fromStatus: FourEyesStatus } | null
  demote: { id: number; fromStatus: FourEyesStatus; toStatus: 'pending' | 'manually_approved' } | null
}

export function computeBaselineRecomputePlan(
  oldMarker: BaselineMarker | null,
  newFirst: BaselineMarker | null,
): BaselineRecomputePlan {
  if (!newFirst) {
    return { promote: null, demote: demotePlan(oldMarker) }
  }

  if (oldMarker && oldMarker.id === newFirst.id) {
    return { promote: null, demote: null }
  }

  const promote =
    newFirst.four_eyes_status === 'pending_baseline' || newFirst.four_eyes_status === 'baseline'
      ? null
      : { id: newFirst.id, fromStatus: newFirst.four_eyes_status }

  return { promote, demote: demotePlan(oldMarker) }
}

function demotePlan(marker: BaselineMarker | null): BaselineRecomputePlan['demote'] {
  if (!marker) return null
  if (marker.four_eyes_status === 'pending_baseline') {
    return { id: marker.id, fromStatus: marker.four_eyes_status, toStatus: 'pending' }
  }
  if (marker.four_eyes_status === 'baseline') {
    return { id: marker.id, fromStatus: marker.four_eyes_status, toStatus: 'manually_approved' }
  }
  return null
}
