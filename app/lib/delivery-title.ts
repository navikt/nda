export function isExclusivelyThisPr(
  hasPrNumber: boolean,
  deliveryCommitShas: string[],
  prCommitShas: Set<string> | null,
): boolean {
  return hasPrNumber && prCommitShas !== null && deliveryCommitShas.every((sha) => prCommitShas.has(sha))
}

export function computeDisplayTitle(
  baseTitle: string | null,
  deliveryCommitCount: number,
  exclusivelyThisPr: boolean,
): string | null {
  if (!baseTitle || exclusivelyThisPr || deliveryCommitCount <= 1) {
    return baseTitle
  }
  const extraCount = deliveryCommitCount - 1
  return `${baseTitle} + ${extraCount} commit${extraCount > 1 ? 'ter' : ''} til`
}
