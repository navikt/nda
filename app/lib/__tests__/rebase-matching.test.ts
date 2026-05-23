import { describe, expect, it } from 'vitest'

/**
 * Tests for rebase commit matching logic.
 *
 * When using "rebase and merge", commits get new SHAs because their parent changes.
 * The GitHub API `listPullRequestsAssociatedWithCommit` won't find these commits.
 * We need to match them by metadata: author + author_date + message.
 */

// Test data from real PRs (anonymized)

// Test Case 1: Rebase and Merge
// All 9 rebased commits should match to PR via metadata

const PR_18375_ORIGINAL_COMMITS = [
  {
    sha: '4e7ffafdaad4e955a4ab762ecf0ae8ff25719bea',
    message: 'UFO-192: tjeneste for å hente ut krav for din ufør',
    author: 'author-a',
    author_date: '2025-12-03T14:00:53Z',
  },
  {
    sha: '1b262eb8ca0ffdde11d132b42e51224856cdaa06',
    message: 'UFO-192: tjeneste for å hente ut krav og vedtak if',
    author: 'author-a',
    author_date: '2026-01-09T13:10:32Z',
  },
  {
    sha: '6827de89626c8bec632c7086472522d40b154c3b',
    message: 'UFO-192: henter vedtak som er iverksatt eller unde',
    author: 'author-a',
    author_date: '2026-01-20T19:54:36Z',
  },
  {
    sha: 'b505bb0f9fed77b53f9c4ce578c8ba064c0f8eb5',
    message: 'UFO-192: sjekker om saksid hører til bruker',
    author: 'author-a',
    author_date: '2026-01-22T12:29:07Z',
  },
  {
    sha: '99357c1892c670ada687db13831601534ccf38d5',
    message: 'UFO-194: bruker gjeldende vedtak + komprimerer lit',
    author: 'author-a',
    author_date: '2026-01-12T13:16:48Z',
  },
  {
    sha: '0124e4c312050fdaf4756b42d0214c10af3df90e',
    message: 'UFO-194: nye data som trengs på din uføretrygd-sid',
    author: 'author-a',
    author_date: '2026-01-20T19:52:32Z',
  },
  {
    sha: 'f5faefeeba144a86e7c52f6bff39bd3f0f7fac06',
    message: 'UFO-194: riktigere navn nettoUtbetalingMnd',
    author: 'author-a',
    author_date: '2026-01-21T16:16:09Z',
  },
  {
    sha: '835bdd03aa72358677086778fe4bb236bfa06fa0',
    message: 'UFO-194: oppdaterer tester etter oppdateringer i v',
    author: 'author-a',
    author_date: '2026-01-22T13:11:12Z',
  },
  {
    sha: '1cf1c13d2535706900a90c4f99ea3e74305d6f2a',
    message: 'UFO-194: behandle null på beregnet uførehistorikk',
    author: 'author-a',
    author_date: '2026-01-23T09:06:48Z',
  },
]

const PR_18375_REBASED_COMMITS = [
  {
    sha: '7b863d784d7b6e833d4464dc9c756e0c5fbbc261',
    message: 'UFO-192: tjeneste for å hente ut krav for din ufør',
    author: 'author-a',
    author_date: '2025-12-03T14:00:53Z',
  },
  {
    sha: 'e37ab14f348f874c2a03ea85b4b4096953e1fb46',
    message: 'UFO-192: tjeneste for å hente ut krav og vedtak if',
    author: 'author-a',
    author_date: '2026-01-09T13:10:32Z',
  },
  {
    sha: '0e4067f1c61689b35d715230bb2701c241dc82a0',
    message: 'UFO-192: henter vedtak som er iverksatt eller unde',
    author: 'author-a',
    author_date: '2026-01-20T19:54:36Z',
  },
  {
    sha: '3c51ca3c667651950f8cf2d3acc0d1d110d6e290',
    message: 'UFO-192: sjekker om saksid hører til bruker',
    author: 'author-a',
    author_date: '2026-01-22T12:29:07Z',
  },
  {
    sha: '93a5868d92a321479e6833b0e0ca08ff625ea410',
    message: 'UFO-194: bruker gjeldende vedtak + komprimerer lit',
    author: 'author-a',
    author_date: '2026-01-12T13:16:48Z',
  },
  {
    sha: '79bfb866e2343a305d05b389c5586338f84192dd',
    message: 'UFO-194: nye data som trengs på din uføretrygd-sid',
    author: 'author-a',
    author_date: '2026-01-20T19:52:32Z',
  },
  {
    sha: '565e7624a1da926c24eb1b669086f9c3043a41f1',
    message: 'UFO-194: riktigere navn nettoUtbetalingMnd',
    author: 'author-a',
    author_date: '2026-01-21T16:16:09Z',
  },
  {
    sha: '78d6ffb6df21b1de1638f70fb9dd3a7342b002ef',
    message: 'UFO-194: oppdaterer tester etter oppdateringer i v',
    author: 'author-a',
    author_date: '2026-01-22T13:11:12Z',
  },
  {
    sha: '1fe00f15bed928e0f10d4c8631e6b319f139106a',
    message: 'UFO-194: behandle null på beregnet uførehistorikk',
    author: 'author-a',
    author_date: '2026-01-23T09:06:48Z',
  },
]

// Commits from other PRs that should NOT match
const NON_MATCHING_COMMITS = [
  {
    sha: 'd1b023601268dc84eea894b78529ffd80df35bbd',
    message: 'Endepunkt mottar eller har mottatt afp privat.',
    author: 'author-b',
    author_date: '2026-01-22T08:34:24Z',
  },
  {
    sha: 'dd83857f4e270d60877ba6e8d611cc636b8901d9',
    message: 'Merge pull request #18369',
    author: 'author-b',
    author_date: '2026-01-22T13:18:04Z',
  },
  {
    sha: '9791c42b2cc8060955cc595abd16c3e28247b9a5',
    message: 'Bump org.openrewrite.maven:rewrite-maven-plugin',
    author: 'dependabot[bot]',
    author_date: '2026-01-23T08:41:05Z',
  },
]

// Test Case 2: Normal Merge with extra commits (PR #2156 - pensjon-psak)
// Merge-commit should be detected as NOT part of PR-commits → "Ikke-godkjente commits"
const PR_2156_METADATA = {
  number: 2156,
  base_sha: 'e3a7e8bbb8e698f08742525a7530d08400ef3a57',
  head_sha: '72e1a350540e007163a9a5a047f785e944d6052e',
  merge_commit_sha: 'eb39ed6f924d97a4a0392484066d8d765ac385d8',
  merged_at: '2025-11-26T08:16:49Z',
  title: 'Legger til redirect for dokdisk',
}

const PR_2156_ORIGINAL_COMMITS = [
  {
    sha: '72e1a350540e007163a9a5a047f785e944d6052e',
    message: 'Legger til redireect for dokdisk som tidligere gikk igjennom',
    author: 'author-c',
    author_date: '2025-11-26T07:08:35Z',
  },
]

const PR_2156_MAIN_COMMITS = [
  {
    sha: '72e1a350540e007163a9a5a047f785e944d6052e',
    message: 'Legger til redireect for dokdisk som tidligere gikk igjennom',
    author: 'author-c',
    author_date: '2025-11-26T07:08:35Z',
  },
  {
    // This is a merge commit - should NOT match PR commits
    sha: 'eb39ed6f924d97a4a0392484066d8d765ac385d8',
    message: 'Merge pull request #2156 from navikt/legger-til-redirect-for',
    author: 'author-c',
    author_date: '2025-11-26T08:16:49Z',
  },
]

// Test Case 3: Normal Merge without extra commits (PR #18424 - pensjon-pen)
// Dependabot PR, 1 commit - should be approved
const PR_18424_METADATA = {
  number: 18424,
  base_sha: 'd03dffe5dd3860c899913845b1bb1f015644ba00',
  head_sha: '2f5e4a38e18418179e9b9b261152efa7da47abe2',
  merge_commit_sha: '9eb0ebadfedc4305af64a1bdf9977b0349421f04',
  merged_at: '2026-01-28T07:38:18Z',
  merged_by: 'author-d',
  user: 'dependabot[bot]',
  title: 'Bump org.openrewrite.maven:rewrite-maven-plugin from 6.27.1',
}

const PR_18424_ORIGINAL_COMMITS = [
  {
    sha: '2f5e4a38e18418179e9b9b261152efa7da47abe2',
    message: 'Bump org.openrewrite.maven:rewrite-maven-plugin from 6.27.1',
    author: 'dependabot[bot]',
    author_date: '2026-01-27T22:39:15Z',
  },
]

const PR_18424_MAIN_COMMITS = [
  {
    sha: '2f5e4a38e18418179e9b9b261152efa7da47abe2',
    message: 'Bump org.openrewrite.maven:rewrite-maven-plugin from 6.27.1',
    author: 'dependabot[bot]',
    author_date: '2026-01-27T22:39:15Z',
  },
  {
    sha: '9eb0ebadfedc4305af64a1bdf9977b0349421f04',
    message: 'Merge pull request #18424 from navikt/dependabot/maven/org.o',
    author: 'author-d',
    author_date: '2026-01-28T07:38:17Z',
  },
]

// Pure matching function (extracted for unit testing)
function matchCommitMetadata(
  mainCommit: { author: string; author_date: string; message: string },
  prCommit: { author: string; author_date: string; message: string },
): boolean {
  const authorMatch = mainCommit.author.toLowerCase() === prCommit.author.toLowerCase()

  // Date match within 1 second
  const mainDate = new Date(mainCommit.author_date)
  const prDate = new Date(prCommit.author_date)
  const dateDiffMs = Math.abs(mainDate.getTime() - prDate.getTime())
  const dateMatch = dateDiffMs < 1000

  // First line of message
  const mainMessageFirst = mainCommit.message.split('\n')[0].trim()
  const prMessageFirst = prCommit.message.split('\n')[0].trim()
  const messageMatch = mainMessageFirst === prMessageFirst

  return authorMatch && dateMatch && messageMatch
}

describe('Rebase Commit Matching', () => {
  describe('matchCommitMetadata', () => {
    it('should match identical commits', () => {
      const commit = PR_18375_ORIGINAL_COMMITS[0]
      expect(
        matchCommitMetadata(
          { author: commit.author, author_date: commit.author_date, message: commit.message },
          { author: commit.author, author_date: commit.author_date, message: commit.message },
        ),
      ).toBe(true)
    })

    it('should match rebased commits with different SHAs but same metadata', () => {
      // Original and rebased commits should match
      for (let i = 0; i < PR_18375_ORIGINAL_COMMITS.length; i++) {
        const original = PR_18375_ORIGINAL_COMMITS[i]
        const rebased = PR_18375_REBASED_COMMITS[i]

        const result = matchCommitMetadata(
          { author: rebased.author, author_date: rebased.author_date, message: rebased.message },
          { author: original.author, author_date: original.author_date, message: original.message },
        )

        expect(result).toBe(true)
      }
    })

    it('should NOT match commits with different authors', () => {
      const commit1 = PR_18375_ORIGINAL_COMMITS[0]
      const commit2 = NON_MATCHING_COMMITS[0] // Different author

      expect(
        matchCommitMetadata(
          { author: commit1.author, author_date: commit1.author_date, message: commit1.message },
          { author: commit2.author, author_date: commit2.author_date, message: commit2.message },
        ),
      ).toBe(false)
    })

    it('should NOT match commits with different messages', () => {
      const commit1 = PR_18375_ORIGINAL_COMMITS[0]
      const commit2 = PR_18375_ORIGINAL_COMMITS[1] // Different message

      expect(
        matchCommitMetadata(
          { author: commit1.author, author_date: commit1.author_date, message: commit1.message },
          { author: commit2.author, author_date: commit2.author_date, message: commit2.message },
        ),
      ).toBe(false)
    })

    it('should NOT match commits with different dates', () => {
      const commit1 = PR_18375_ORIGINAL_COMMITS[0]

      expect(
        matchCommitMetadata(
          { author: commit1.author, author_date: commit1.author_date, message: commit1.message },
          { author: commit1.author, author_date: '2020-01-01T00:00:00Z', message: commit1.message },
        ),
      ).toBe(false)
    })

    it('should be case-insensitive for author names', () => {
      const commit = PR_18375_ORIGINAL_COMMITS[0]

      expect(
        matchCommitMetadata(
          { author: commit.author.toUpperCase(), author_date: commit.author_date, message: commit.message },
          { author: commit.author.toLowerCase(), author_date: commit.author_date, message: commit.message },
        ),
      ).toBe(true)
    })
  })

  describe('Test Case 1: Rebase and Merge (PR #18375)', () => {
    it('should have matching metadata for all 9 rebased commits', () => {
      expect(PR_18375_ORIGINAL_COMMITS.length).toBe(9)
      expect(PR_18375_REBASED_COMMITS.length).toBe(9)

      // Each rebased commit should match its corresponding original
      for (let i = 0; i < 9; i++) {
        const original = PR_18375_ORIGINAL_COMMITS[i]
        const rebased = PR_18375_REBASED_COMMITS[i]

        // SHAs should be different
        expect(rebased.sha).not.toBe(original.sha)

        // But metadata should match
        expect(rebased.author).toBe(original.author)
        expect(rebased.author_date).toBe(original.author_date)
        expect(rebased.message).toBe(original.message)
      }
    })

    it('should NOT match non-related commits', () => {
      for (const nonMatching of NON_MATCHING_COMMITS) {
        for (const original of PR_18375_ORIGINAL_COMMITS) {
          const result = matchCommitMetadata(
            {
              author: nonMatching.author,
              author_date: nonMatching.author_date,
              message: nonMatching.message,
            },
            { author: original.author, author_date: original.author_date, message: original.message },
          )
          expect(result).toBe(false)
        }
      }
    })
  })

  describe('Test Case 2: Normal Merge with extra commits (PR #2156)', () => {
    it('should match the original commit by SHA', () => {
      const originalCommit = PR_2156_ORIGINAL_COMMITS[0]
      const mainCommit = PR_2156_MAIN_COMMITS[0]

      // Same SHA - direct match
      expect(mainCommit.sha).toBe(originalCommit.sha)
    })

    it('should NOT match the merge commit to PR commits', () => {
      const mergeCommit = PR_2156_MAIN_COMMITS[1]

      // Verify it's the merge commit
      expect(mergeCommit.sha).toBe(PR_2156_METADATA.merge_commit_sha)

      // Merge commit should not match any PR commit via metadata
      for (const original of PR_2156_ORIGINAL_COMMITS) {
        const result = matchCommitMetadata(
          { author: mergeCommit.author, author_date: mergeCommit.author_date, message: mergeCommit.message },
          { author: original.author, author_date: original.author_date, message: original.message },
        )
        expect(result).toBe(false)
      }
    })
  })

  describe('Test Case 3: Normal Merge (PR #18424 - Dependabot)', () => {
    it('should match the dependabot commit by SHA', () => {
      const originalCommit = PR_18424_ORIGINAL_COMMITS[0]
      const mainCommit = PR_18424_MAIN_COMMITS[0]

      expect(mainCommit.sha).toBe(originalCommit.sha)
    })

    it('should recognize merge commit as the merge_commit_sha', () => {
      const mergeCommit = PR_18424_MAIN_COMMITS[1]
      expect(mergeCommit.sha).toBe(PR_18424_METADATA.merge_commit_sha)
    })

    it('dependabot PR with human merger should pass four-eyes', () => {
      // Dependabot created the PR
      expect(PR_18424_METADATA.user).toBe('dependabot[bot]')
      // Human merged it
      expect(PR_18424_METADATA.merged_by).toBe('author-d')
      // Different actors = four-eyes OK
      expect(PR_18424_METADATA.user).not.toBe(PR_18424_METADATA.merged_by)
    })
  })

  describe('Edge cases', () => {
    it('should handle commits with same message but different author', () => {
      // Two people might have the same commit message (e.g., "fix typo")
      // but different authors - should NOT match
      const result = matchCommitMetadata(
        { author: 'author-a', author_date: '2026-01-01T12:00:00Z', message: 'fix typo' },
        { author: 'author-b', author_date: '2026-01-01T12:00:00Z', message: 'fix typo' },
      )
      expect(result).toBe(false)
    })

    it('should handle commits with same author but different date (within 1 second)', () => {
      // Same author, same message, date within 1 second should match
      const result = matchCommitMetadata(
        { author: 'author-a', author_date: '2026-01-01T12:00:00.500Z', message: 'fix typo' },
        { author: 'author-a', author_date: '2026-01-01T12:00:00.000Z', message: 'fix typo' },
      )
      expect(result).toBe(true)
    })

    it('should handle commits with same author but different date (more than 1 second)', () => {
      // Same author, same message, but date more than 1 second apart - should NOT match
      const result = matchCommitMetadata(
        { author: 'author-a', author_date: '2026-01-01T12:00:02Z', message: 'fix typo' },
        { author: 'author-a', author_date: '2026-01-01T12:00:00Z', message: 'fix typo' },
      )
      expect(result).toBe(false)
    })

    it('should match only first line of commit message', () => {
      // Multi-line message should only compare first line
      const result = matchCommitMetadata(
        {
          author: 'author-a',
          author_date: '2026-01-01T12:00:00Z',
          message: 'fix typo\n\nThis is a longer description',
        },
        { author: 'author-a', author_date: '2026-01-01T12:00:00Z', message: 'fix typo' },
      )
      expect(result).toBe(true)
    })
  })
})
