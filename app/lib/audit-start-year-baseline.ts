import type { FourEyesStatus } from './four-eyes-status'

export interface BaselineMarker {
  id: number
  four_eyes_status: FourEyesStatus
}

export interface BaselineRecomputePlan {
  promote: { id: number; fromStatus: FourEyesStatus } | null
  demotes: { id: number; fromStatus: FourEyesStatus; toStatus: 'pending' | 'manually_approved' }[]
}

export function computeBaselineRecomputePlan(
  oldMarkers: BaselineMarker[],
  newFirst: BaselineMarker | null,
): BaselineRecomputePlan {
  const staleMarkers = oldMarkers.filter((marker) => marker.id !== newFirst?.id)
  const demotes = staleMarkers.map(demotePlan).filter((demote): demote is NonNullable<typeof demote> => demote !== null)

  if (!newFirst) {
    return { promote: null, demotes }
  }

  const newFirstIsExistingMarker = oldMarkers.some((marker) => marker.id === newFirst.id)
  if (newFirstIsExistingMarker) {
    return { promote: null, demotes }
  }

  const promote =
    newFirst.four_eyes_status === 'pending_baseline' || newFirst.four_eyes_status === 'baseline'
      ? null
      : { id: newFirst.id, fromStatus: newFirst.four_eyes_status }

  return { promote, demotes }
}

function demotePlan(
  marker: BaselineMarker,
): { id: number; fromStatus: FourEyesStatus; toStatus: 'pending' | 'manually_approved' } | null {
  if (marker.four_eyes_status === 'pending_baseline') {
    return { id: marker.id, fromStatus: marker.four_eyes_status, toStatus: 'pending' }
  }
  if (marker.four_eyes_status === 'baseline') {
    return { id: marker.id, fromStatus: marker.four_eyes_status, toStatus: 'manually_approved' }
  }
  return null
}

export function resolveConsistentAuditStartYear(auditStartYears: (number | null)[]): number | null {
  if (auditStartYears.some((year) => year === null)) return null
  const years = auditStartYears.filter((year): year is number => year !== null)
  return years.length > 0 ? years.reduce((min, year) => (year < min ? year : min)) : null
}
