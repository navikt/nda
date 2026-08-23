import type { RestEndpointMethodTypes } from '@octokit/rest'
import type { CompareData } from '~/lib/verification/types'

export type RawCompareResponse = RestEndpointMethodTypes['repos']['compareCommits']['response']['data']

export function mapCompareResponse(response: RawCompareResponse): CompareData {
  const rawCommits = response.commits || []
  const rawFiles = response.files || []

  const commits = rawCommits.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
    authorUsername: commit.author?.login || commit.commit.author?.name || 'unknown',
    authorDate: commit.commit.author?.date || '',
    committerDate: commit.commit.committer?.date || commit.commit.author?.date || '',
    htmlUrl: commit.html_url,
    isMergeCommit: (commit.parents?.length || 0) > 1,
    parentShas: commit.parents?.map((p) => p.sha) || [],
  }))

  return {
    compare: {
      status: response.status,
      aheadBy: response.ahead_by,
      behindBy: response.behind_by,
      totalCommits: response.total_commits,
      changedFiles: rawFiles.length,
      noDiffDetected: false,
    },
    commits,
  }
}
