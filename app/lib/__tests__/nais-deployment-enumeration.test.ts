import { describe, expect, it } from 'vitest'
import {
  haveSameNaisDeploymentIds,
  type NaisDeploymentEnumerationPage,
  validateNaisDeploymentEnumeration,
} from '../nais-deployment-enumeration'

function page(
  deploymentIds: string[],
  options: Partial<Pick<NaisDeploymentEnumerationPage, 'totalCount' | 'hasNextPage' | 'endCursor'>> = {},
): NaisDeploymentEnumerationPage {
  return {
    deploymentIds,
    totalCount: options.totalCount ?? 2,
    hasNextPage: options.hasNextPage ?? false,
    endCursor: options.endCursor ?? null,
  }
}

describe('validateNaisDeploymentEnumeration', () => {
  it('accepts one complete page with the expected unique ID count', () => {
    expect(validateNaisDeploymentEnumeration([page(['deployment-a', 'deployment-b'])])).toEqual({
      status: 'complete',
      totalCount: 2,
      deploymentIds: ['deployment-a', 'deployment-b'],
    })
  })

  it('accepts a complete multi-page enumeration', () => {
    expect(
      validateNaisDeploymentEnumeration([
        page(['deployment-b'], { hasNextPage: true, endCursor: 'cursor-a' }),
        page(['deployment-a'], { endCursor: 'cursor-b' }),
      ]),
    ).toEqual({
      status: 'complete',
      totalCount: 2,
      deploymentIds: ['deployment-a', 'deployment-b'],
    })
  })

  it('accepts an empty enumeration', () => {
    expect(validateNaisDeploymentEnumeration([page([], { totalCount: 0 })])).toEqual({
      status: 'complete',
      totalCount: 0,
      deploymentIds: [],
    })
  })

  it('rejects an empty page list', () => {
    expect(validateNaisDeploymentEnumeration([])).toMatchObject({ status: 'incomplete', reason: 'no_pages' })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid total count %s', (totalCount) => {
    expect(validateNaisDeploymentEnumeration([page([], { totalCount })])).toMatchObject({
      status: 'incomplete',
      reason: 'invalid_total_count',
    })
  })

  it('rejects total counts that differ across pages', () => {
    expect(
      validateNaisDeploymentEnumeration([
        page(['deployment-a'], { totalCount: 2, hasNextPage: true, endCursor: 'cursor-a' }),
        page(['deployment-b'], { totalCount: 3 }),
      ]),
    ).toMatchObject({ status: 'incomplete', reason: 'inconsistent_total_count', pageIndex: 1 })
  })

  it.each(['', '   '])('rejects invalid deployment IDs %j', (deploymentId) => {
    expect(validateNaisDeploymentEnumeration([page([deploymentId])])).toMatchObject({
      status: 'incomplete',
      reason: 'invalid_deployment_id',
    })
  })

  it('rejects duplicate IDs within and across pages', () => {
    expect(
      validateNaisDeploymentEnumeration([
        page(['deployment-a'], { hasNextPage: true, endCursor: 'cursor-a' }),
        page(['deployment-a']),
      ]),
    ).toMatchObject({ status: 'incomplete', reason: 'duplicate_deployment_id', pageIndex: 1 })
  })

  it('rejects an ID set shorter than totalCount', () => {
    expect(validateNaisDeploymentEnumeration([page(['deployment-a'])])).toMatchObject({
      status: 'incomplete',
      reason: 'id_count_mismatch',
    })
  })

  it('rejects a page that claims more results without a following page', () => {
    expect(
      validateNaisDeploymentEnumeration([page(['deployment-a'], { totalCount: 2, hasNextPage: true })]),
    ).toMatchObject({ status: 'incomplete', reason: 'missing_page', pageIndex: 0 })
  })

  it('rejects pages after pagination ended', () => {
    expect(
      validateNaisDeploymentEnumeration([page(['deployment-a'], { hasNextPage: false }), page(['deployment-b'])]),
    ).toMatchObject({ status: 'incomplete', reason: 'unexpected_page', pageIndex: 0 })
  })

  it('rejects a next-page response without an end cursor', () => {
    expect(
      validateNaisDeploymentEnumeration([
        page(['deployment-a'], { totalCount: 2, hasNextPage: true }),
        page(['deployment-b']),
      ]),
    ).toMatchObject({ status: 'incomplete', reason: 'missing_cursor', pageIndex: 0 })
  })

  it('rejects a repeated cursor', () => {
    expect(
      validateNaisDeploymentEnumeration([
        page(['deployment-a'], { hasNextPage: true, endCursor: 'cursor-a' }),
        page(['deployment-b'], { endCursor: 'cursor-a' }),
      ]),
    ).toMatchObject({ status: 'incomplete', reason: 'duplicate_cursor', pageIndex: 1 })
  })
})

describe('haveSameNaisDeploymentIds', () => {
  function complete(deploymentIds: string[]) {
    const result = validateNaisDeploymentEnumeration([page(deploymentIds)])
    if (result.status !== 'complete') throw new Error(`Expected complete enumeration, got ${result.reason}`)
    return result
  }

  it('compares ID sets independently of enumeration order', () => {
    expect(
      haveSameNaisDeploymentIds(
        { status: 'complete', totalCount: 2, deploymentIds: ['deployment-b', 'deployment-a'] },
        { status: 'complete', totalCount: 2, deploymentIds: ['deployment-a', 'deployment-b'] },
      ),
    ).toBe(true)
  })

  it('detects changed ID sets even when counts match', () => {
    expect(
      haveSameNaisDeploymentIds(complete(['deployment-a', 'deployment-b']), {
        status: 'complete',
        totalCount: 2,
        deploymentIds: ['deployment-a', 'deployment-c'],
      }),
    ).toBe(false)
  })
})
