import { useCallback, useEffect, useState } from 'react'
import { useFetcher } from 'react-router'

interface SlackLookupResponse {
  slackMemberId: string | null
}

export interface SlackMemberIdLookup {
  slackMemberId: string | null
  isLoading: boolean
  isAutoDetected: boolean
  lookup: (navIdent: string) => void
  reset: () => void
}

export function useSlackMemberIdLookup(): SlackMemberIdLookup {
  const fetcher = useFetcher<SlackLookupResponse>()
  const [slackMemberId, setSlackMemberId] = useState<string | null>(null)

  useEffect(() => {
    if (fetcher.data) {
      setSlackMemberId(fetcher.data.slackMemberId ?? null)
    }
  }, [fetcher.data])

  const isLoading = fetcher.state !== 'idle'

  const lookup = useCallback(
    (navIdent: string) => {
      setSlackMemberId(null)
      fetcher.load(`/api/users/slack-lookup?nav_ident=${encodeURIComponent(navIdent)}`)
    },
    [fetcher.load],
  )

  const reset = useCallback(() => setSlackMemberId(null), [])

  return {
    slackMemberId,
    isLoading,
    isAutoDetected: !isLoading && !!slackMemberId,
    lookup,
    reset,
  }
}
