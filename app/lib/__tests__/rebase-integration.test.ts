import { describe, expect, it } from 'vitest'

const PR_18375 = {
  number: 18375,
  title: 'Feature/ufo 194 forside saksinfo',
  state: 'closed',
  merged_at: '2026-01-23T09:43:02Z',
  merge_commit_sha: '1fe00f15bed928e0f10d4c8631e6b319f139106a',
  base_sha: '32d2be81aa26cac697a3424ad0e17a6aa7c7b231',
  head_sha: '1cf1c13d2535706900a90c4f99ea3e74305d6f2a',
  user: 'developer-a',
  merged_by: 'developer-a',
  reviews: [
    { user: 'reviewer-b', state: 'DISMISSED', submitted_at: '2026-01-22T13:53:39Z' },
    { user: 'reviewer-b', state: 'APPROVED', submitted_at: '2026-01-23T09:31:37Z' },
  ],
}

const PR_ORIGINAL_COMMITS = [
  {
    sha: '4e7ffafdaad4e955a4ab762ecf0ae8ff25719bea',
    author_name: 'developer-a',
    author_date: '2025-12-03T14:00:53Z',
    message: 'UFO-192: tjeneste for å hente ut krav for din uføretrygd',
  },
  {
    sha: '1b262eb8ca0ffdde11d132b42e51224856cdaa06',
    author_name: 'developer-a',
    author_date: '2026-01-09T13:10:32Z',
    message: 'UFO-192: tjeneste for å hente ut krav og vedtak ifbm din uføretrygd saksoversikt',
  },
  {
    sha: '6827de89626c8bec632c7086472522d40b154c3b',
    author_name: 'developer-a',
    author_date: '2026-01-20T19:54:36Z',
    message:
      'UFO-192: henter vedtak som er iverksatt eller under iverksettelse + bruker vedtaksdato som alltid er populert',
  },
  {
    sha: 'b505bb0f9fed77b53f9c4ce578c8ba064c0f8eb5',
    author_name: 'developer-a',
    author_date: '2026-01-22T12:29:07Z',
    message: 'UFO-192: sjekker om saksid hører til bruker',
  },
  {
    sha: '99357c1892c670ada687db13831601534ccf38d5',
    author_name: 'developer-a',
    author_date: '2026-01-12T13:16:48Z',
    message: 'UFO-194: bruker gjeldende vedtak + komprimerer litt',
  },
  {
    sha: '0124e4c312050fdaf4756b42d0214c10af3df90e',
    author_name: 'developer-a',
    author_date: '2026-01-20T19:52:32Z',
    message: 'UFO-194: nye data som trengs på din uføretrygd-siden + henter gjeldende vedtak per idag',
  },
  {
    sha: 'f5faefeeba144a86e7c52f6bff39bd3f0f7fac06',
    author_name: 'developer-a',
    author_date: '2026-01-21T16:16:09Z',
    message: 'UFO-194: riktigere navn nettoUtbetalingMnd',
  },
  {
    sha: '835bdd03aa72358677086778fe4bb236bfa06fa0',
    author_name: 'developer-a',
    author_date: '2026-01-22T13:11:12Z',
    message: 'UFO-194: oppdaterer tester etter oppdateringer i vedtakssammendragservice',
  },
  {
    sha: '1cf1c13d2535706900a90c4f99ea3e74305d6f2a',
    author_name: 'developer-a',
    author_date: '2026-01-23T09:06:48Z',
    message: 'UFO-194: behandle null på beregnet uførehistorikk',
  },
]

const REBASED_COMMITS_ON_MAIN = [
  {
    sha: '7b863d784d7b6e833d4464dc9c756e0c5fbbc261',
    author_name: 'developer-a',
    author_date: '2025-12-03T14:00:53Z',
    message: 'UFO-192: tjeneste for å hente ut krav for din uføretrygd',
  },
  {
    sha: 'e37ab14f348f874c2a03ea85b4b4096953e1fb46',
    author_name: 'developer-a',
    author_date: '2026-01-09T13:10:32Z',
    message: 'UFO-192: tjeneste for å hente ut krav og vedtak ifbm din uføretrygd saksoversikt',
  },
  {
    sha: '0e4067f1c61689b35d715230bb2701c241dc82a0',
    author_name: 'developer-a',
    author_date: '2026-01-20T19:54:36Z',
    message:
      'UFO-192: henter vedtak som er iverksatt eller under iverksettelse + bruker vedtaksdato som alltid er populert',
  },
  {
    sha: '3c51ca3c667651950f8cf2d3acc0d1d110d6e290',
    author_name: 'developer-a',
    author_date: '2026-01-22T12:29:07Z',
    message: 'UFO-192: sjekker om saksid hører til bruker',
  },
  {
    sha: '93a5868d92a321479e6833b0e0ca08ff625ea410',
    author_name: 'developer-a',
    author_date: '2026-01-12T13:16:48Z',
    message: 'UFO-194: bruker gjeldende vedtak + komprimerer litt',
  },
  {
    sha: '79bfb866e2343a305d05b389c5586338f84192dd',
    author_name: 'developer-a',
    author_date: '2026-01-20T19:52:32Z',
    message: 'UFO-194: nye data som trengs på din uføretrygd-siden + henter gjeldende vedtak per idag',
  },
  {
    sha: '565e7624a1da926c24eb1b669086f9c3043a41f1',
    author_name: 'developer-a',
    author_date: '2026-01-21T16:16:09Z',
    message: 'UFO-194: riktigere navn nettoUtbetalingMnd',
  },
  {
    sha: '78d6ffb6df21b1de1638f70fb9dd3a7342b002ef',
    author_name: 'developer-a',
    author_date: '2026-01-22T13:11:12Z',
    message: 'UFO-194: oppdaterer tester etter oppdateringer i vedtakssammendragservice',
  },
  {
    sha: '1fe00f15bed928e0f10d4c8631e6b319f139106a',
    author_name: 'developer-a',
    author_date: '2026-01-23T09:06:48Z',
    message: 'UFO-194: behandle null på beregnet uførehistorikk',
  },
]

const OTHER_COMMITS_ON_MAIN = [
  {
    sha: 'd1b023601268dc84eea894b78529ffd80df35bbd',
    author_name: 'developer-c',
    author_date: '2026-01-22T08:34:24Z',
    message: 'Endepunkt mottar eller har mottatt afp privat.',
  },
  {
    sha: '94ecc74b8a630a2039ec89eaa11cc5101c4f4e76',
    author_name: 'developer-c',
    author_date: '2026-01-22T08:46:24Z',
    message: 'Fikser navn på dataklasse og legger til tester.',
  },
  {
    sha: 'dd83857f4e270d60877ba6e8d611cc636b8901d9',
    author_name: 'developer-c',
    author_date: '2026-01-22T13:18:04Z',
    message: 'Merge pull request #18369 from navikt/mottar-eller-har-mottatt-afpprivat',
  },
  {
    sha: '9791c42b2cc8060955cc595abd16c3e28247b9a5',
    author_name: 'dependabot[bot]',
    author_date: '2026-01-23T08:41:05Z',
    message: 'Bump org.openrewrite.maven:rewrite-maven-plugin from 6.26.0 to 6.27.1 (#18381)',
  },
]

function matchCommitMetadata(
  mainCommit: { author_name: string; author_date: string; message: string },
  prCommit: { author_name: string; author_date: string; message: string },
): boolean {
  const authorMatch = mainCommit.author_name.toLowerCase() === prCommit.author_name.toLowerCase()

  const mainDate = new Date(mainCommit.author_date)
  const prDate = new Date(prCommit.author_date)
  const dateDiffMs = Math.abs(mainDate.getTime() - prDate.getTime())
  const dateMatch = dateDiffMs < 1000

  const mainMessageFirst = mainCommit.message.split('\n')[0].trim()
  const prMessageFirst = prCommit.message.split('\n')[0].trim()
  const messageMatch = mainMessageFirst === prMessageFirst

  return authorMatch && dateMatch && messageMatch
}

function findMatchingPRCommit(
  rebasedCommit: { sha: string; author_name: string; author_date: string; message: string },
  prCommits: Array<{ sha: string; author_name: string; author_date: string; message: string }>,
): { sha: string; matched: boolean } | null {
  for (const prCommit of prCommits) {
    if (matchCommitMetadata(rebasedCommit, prCommit)) {
      return { sha: prCommit.sha, matched: true }
    }
  }
  return null
}

describe('Rebase and Merge Integration (PR #18375)', () => {
  describe('PR metadata', () => {
    it('should have correct PR information', () => {
      expect(PR_18375.number).toBe(18375)
      expect(PR_18375.state).toBe('closed')
      expect(PR_18375.merged_at).toBeTruthy()
    })

    it('should have approval before merge', () => {
      const approvals = PR_18375.reviews.filter((r) => r.state === 'APPROVED')
      expect(approvals.length).toBeGreaterThan(0)

      const lastApproval = approvals[approvals.length - 1]
      expect(new Date(lastApproval.submitted_at).getTime()).toBeLessThan(new Date(PR_18375.merged_at).getTime())
    })

    it('should have different reviewer than PR author for four-eyes', () => {
      const approvals = PR_18375.reviews.filter((r) => r.state === 'APPROVED')
      const approvers = approvals.map((r) => r.user)

      const hasExternalApprover = approvers.some((approver) => approver !== PR_18375.user)
      expect(hasExternalApprover).toBe(true)
    })
  })

  describe('Commit count verification', () => {
    it('should have same number of original and rebased commits', () => {
      expect(PR_ORIGINAL_COMMITS.length).toBe(9)
      expect(REBASED_COMMITS_ON_MAIN.length).toBe(9)
    })

    it('should have last rebased commit equal to merge_commit_sha', () => {
      const lastRebased = REBASED_COMMITS_ON_MAIN[REBASED_COMMITS_ON_MAIN.length - 1]
      expect(lastRebased.sha).toBe(PR_18375.merge_commit_sha)
    })

    it('should have last original commit equal to head_sha', () => {
      const lastOriginal = PR_ORIGINAL_COMMITS[PR_ORIGINAL_COMMITS.length - 1]
      expect(lastOriginal.sha).toBe(PR_18375.head_sha)
    })
  })

  describe('SHA differences after rebase', () => {
    it('all commits should have different SHAs after rebase', () => {
      for (let i = 0; i < PR_ORIGINAL_COMMITS.length; i++) {
        const original = PR_ORIGINAL_COMMITS[i]
        const rebased = REBASED_COMMITS_ON_MAIN[i]

        expect(rebased.sha).not.toBe(original.sha)
      }
    })
  })

  describe('Metadata matching for rebased commits', () => {
    it('all rebased commits should match their original counterparts', () => {
      for (let i = 0; i < REBASED_COMMITS_ON_MAIN.length; i++) {
        const rebased = REBASED_COMMITS_ON_MAIN[i]
        const original = PR_ORIGINAL_COMMITS[i]

        expect(rebased.author_name).toBe(original.author_name)
        expect(rebased.author_date).toBe(original.author_date)
        expect(rebased.message).toBe(original.message)

        const match = findMatchingPRCommit(rebased, PR_ORIGINAL_COMMITS)
        expect(match).not.toBeNull()
        expect(match?.sha).toBe(original.sha)
      }
    })

    it('each rebased commit should match exactly one original commit', () => {
      for (const rebased of REBASED_COMMITS_ON_MAIN) {
        let matchCount = 0
        for (const original of PR_ORIGINAL_COMMITS) {
          if (matchCommitMetadata(rebased, original)) {
            matchCount++
          }
        }
        expect(matchCount).toBe(1)
      }
    })
  })

  describe('Non-matching commits', () => {
    it('commits from other PRs should NOT match', () => {
      for (const otherCommit of OTHER_COMMITS_ON_MAIN) {
        const match = findMatchingPRCommit(otherCommit, PR_ORIGINAL_COMMITS)
        expect(match).toBeNull()
      }
    })

    it('merge commits should NOT match PR commits', () => {
      const mergeCommits = OTHER_COMMITS_ON_MAIN.filter((c) => c.message.startsWith('Merge pull request'))

      for (const mergeCommit of mergeCommits) {
        const match = findMatchingPRCommit(mergeCommit, PR_ORIGINAL_COMMITS)
        expect(match).toBeNull()
      }
    })

    it('dependabot commits should NOT match PR commits', () => {
      const dependabotCommits = OTHER_COMMITS_ON_MAIN.filter((c) => c.author_name === 'dependabot[bot]')

      for (const depCommit of dependabotCommits) {
        const match = findMatchingPRCommit(depCommit, PR_ORIGINAL_COMMITS)
        expect(match).toBeNull()
      }
    })
  })

  describe('Full verification scenario', () => {
    it('should verify all 9 rebased commits belong to the approved PR', () => {
      const allCommitsOnMain = [...OTHER_COMMITS_ON_MAIN, ...REBASED_COMMITS_ON_MAIN]

      const verificationResults = allCommitsOnMain.map((commit) => {
        const directMatch = PR_ORIGINAL_COMMITS.find((c) => c.sha === commit.sha)
        if (directMatch) {
          return { sha: commit.sha, matched: true, method: 'sha' }
        }

        const metadataMatch = findMatchingPRCommit(commit, PR_ORIGINAL_COMMITS)
        if (metadataMatch) {
          return { sha: commit.sha, matched: true, method: 'metadata' }
        }

        return { sha: commit.sha, matched: false, method: 'none' }
      })

      const rebasedResults = verificationResults.filter((r) => REBASED_COMMITS_ON_MAIN.some((c) => c.sha === r.sha))
      expect(rebasedResults.length).toBe(9)
      expect(rebasedResults.every((r) => r.matched && r.method === 'metadata')).toBe(true)

      const otherResults = verificationResults.filter((r) => OTHER_COMMITS_ON_MAIN.some((c) => c.sha === r.sha))
      expect(otherResults.every((r) => !r.matched)).toBe(true)
    })
  })
})
