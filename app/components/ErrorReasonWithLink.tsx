import { Detail } from '@navikt/ds-react'
import { ExternalLink } from './ExternalLink'

const SHA_DIFF_PATTERN = /Commit SHAs differ \(([a-f0-9]+)→([a-f0-9]+)\)/

interface ErrorReasonWithLinkProps {
  errorReason: string
  githubOwner: string | null
  githubRepoName: string | null
}

export function ErrorReasonWithLink({ errorReason, githubOwner, githubRepoName }: ErrorReasonWithLinkProps) {
  const match = errorReason.match(SHA_DIFF_PATTERN)

  if (match && githubOwner && githubRepoName) {
    const [, fromSha, toSha] = match
    const compareUrl = `https://github.com/${githubOwner}/${githubRepoName}/compare/${fromSha}...${toSha}`

    return (
      <Detail textColor="subtle" className="mt-1">
        {errorReason} <ExternalLink href={compareUrl}>Se endringer på GitHub</ExternalLink>
      </Detail>
    )
  }

  return (
    <Detail textColor="subtle" className="mt-1">
      {errorReason}
    </Detail>
  )
}
