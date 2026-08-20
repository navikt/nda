import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'

interface SlackLookupResponse {
  slackMemberId: string | null
  navIdent?: string
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
  const requestedNavIdentRef = useRef<string | null>(null)

  useEffect(() => {
    if (fetcher.data && fetcher.data.navIdent === requestedNavIdentRef.current) {
      setSlackMemberId(fetcher.data.slackMemberId ?? null)
    }
  }, [fetcher.data])

  const isLoading = fetcher.state !== 'idle'

  const lookup = useCallback(
    (navIdent: string) => {
      const normalized = navIdent.toUpperCase()
      requestedNavIdentRef.current = normalized
      setSlackMemberId(null)
      fetcher.load(`/api/users/slack-lookup?nav_ident=${encodeURIComponent(normalized)}`)
    },
    [fetcher.load],
  )

  const reset = useCallback(() => {
    requestedNavIdentRef.current = null
    setSlackMemberId(null)
  }, [])

  return {
    slackMemberId,
    isLoading,
    isAutoDetected: !isLoading && !!slackMemberId,
    lookup,
    reset,
  }
}
