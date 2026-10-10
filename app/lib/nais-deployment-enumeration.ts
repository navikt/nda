export interface NaisDeploymentEnumerationPage {
  deploymentIds: readonly string[]
  totalCount: number
  hasNextPage: boolean
  endCursor: string | null
}

export interface CompleteNaisDeploymentEnumeration {
  status: 'complete'
  totalCount: number
  deploymentIds: readonly string[]
}

export type NaisDeploymentEnumerationValidation =
  | CompleteNaisDeploymentEnumeration
  | {
      status: 'incomplete'
      reason:
        | 'no_pages'
        | 'invalid_total_count'
        | 'inconsistent_total_count'
        | 'invalid_deployment_id'
        | 'duplicate_deployment_id'
        | 'missing_page'
        | 'unexpected_page'
        | 'missing_cursor'
        | 'duplicate_cursor'
        | 'id_count_mismatch'
      pageIndex?: number
    }

export function validateNaisDeploymentEnumeration(
  pages: readonly NaisDeploymentEnumerationPage[],
): NaisDeploymentEnumerationValidation {
  if (pages.length === 0) return { status: 'incomplete', reason: 'no_pages' }

  const expectedCount = pages[0].totalCount
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
    return { status: 'incomplete', reason: 'invalid_total_count', pageIndex: 0 }
  }

  const deploymentIds = new Set<string>()
  const cursors = new Set<string>()

  for (const [pageIndex, page] of pages.entries()) {
    if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0) {
      return { status: 'incomplete', reason: 'invalid_total_count', pageIndex }
    }
    if (page.totalCount !== expectedCount) {
      return { status: 'incomplete', reason: 'inconsistent_total_count', pageIndex }
    }
    if (pageIndex < pages.length - 1 && !page.hasNextPage) {
      return { status: 'incomplete', reason: 'unexpected_page', pageIndex }
    }
    if (pageIndex === pages.length - 1 && page.hasNextPage) {
      return { status: 'incomplete', reason: 'missing_page', pageIndex }
    }
    if (page.hasNextPage && !page.endCursor?.trim()) {
      return { status: 'incomplete', reason: 'missing_cursor', pageIndex }
    }
    if (page.endCursor) {
      if (cursors.has(page.endCursor)) {
        return { status: 'incomplete', reason: 'duplicate_cursor', pageIndex }
      }
      cursors.add(page.endCursor)
    }

    for (const deploymentId of page.deploymentIds) {
      if (!deploymentId.trim()) {
        return { status: 'incomplete', reason: 'invalid_deployment_id', pageIndex }
      }
      if (deploymentIds.has(deploymentId)) {
        return { status: 'incomplete', reason: 'duplicate_deployment_id', pageIndex }
      }
      deploymentIds.add(deploymentId)
    }
  }

  if (deploymentIds.size !== expectedCount) {
    return { status: 'incomplete', reason: 'id_count_mismatch' }
  }

  return {
    status: 'complete',
    totalCount: expectedCount,
    deploymentIds: [...deploymentIds].sort(),
  }
}

export function haveSameNaisDeploymentIds(
  first: CompleteNaisDeploymentEnumeration,
  second: CompleteNaisDeploymentEnumeration,
): boolean {
  const secondDeploymentIds = new Set(second.deploymentIds)
  return (
    first.totalCount === second.totalCount &&
    first.deploymentIds.length === second.deploymentIds.length &&
    first.deploymentIds.every((deploymentId) => secondDeploymentIds.has(deploymentId))
  )
}
