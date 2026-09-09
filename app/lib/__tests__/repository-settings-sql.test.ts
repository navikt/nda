import { describe, expect, it } from 'vitest'
import { effectiveAuditStartYearSql, effectiveDefaultBranchSql } from '~/db/repository-settings-sql'

function selectsLatestActiveLinkBeforeFilteringNullRepoId(sql: string): boolean {
  const subquery = sql.match(/SELECT ar\.github_repo_id[\s\S]*?LIMIT 1/)?.[0]
  if (!subquery) return false
  return !subquery.includes('IS NOT NULL')
}

describe('repository-settings-sql', () => {
  it('effectiveAuditStartYearSql selects the newest active link before filtering on github_repo_id', () => {
    const sql = effectiveAuditStartYearSql('ma')
    expect(selectsLatestActiveLinkBeforeFilteringNullRepoId(sql)).toBe(true)
  })

  it('effectiveDefaultBranchSql selects the newest active link before filtering on github_repo_id', () => {
    const sql = effectiveDefaultBranchSql('ma')
    expect(selectsLatestActiveLinkBeforeFilteringNullRepoId(sql)).toBe(true)
  })
})
