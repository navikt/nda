import { UNSAFE_Combobox } from '@navikt/ds-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserLookupResult } from '~/lib/user-lookup-types'

interface UserSearchProps {
  label?: string
  onSelect: (navIdent: string) => void
  onSelectUser?: (user: UserLookupResult) => void
  onClear?: () => void
  resetKey?: string | number
  description?: string
}

export function UserSearch({
  label = 'Søk etter bruker',
  onSelect,
  onSelectUser,
  onClear,
  resetKey,
  description,
}: UserSearchProps) {
  const [results, setResults] = useState<UserLookupResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((query: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    if (query.trim().length < 2) {
      setResults([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        const data = await response.json()
        if (controller.signal.aborted) return

        if (!response.ok) {
          setResults([])
          setError(data?.error || 'Søket feilet')
          return
        }
        setResults(data.results ?? [])
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setResults([])
        setError('Søket feilet')
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }, 300)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  const options = results
    .filter((r) => r.navIdent)
    .map((r) => ({
      label: formatUserLabel(r),
      value: r.navIdent as string,
    }))

  return (
    <UNSAFE_Combobox
      key={resetKey}
      label={label}
      description={description}
      options={options}
      filteredOptions={options}
      isLoading={isLoading}
      error={error}
      isListOpen={error ? false : undefined}
      onToggleSelected={(value, isSelected) => {
        if (isSelected) {
          onSelect(value)
          const user = results.find((r) => r.navIdent === value)
          if (user) onSelectUser?.(user)
        } else {
          onClear?.()
        }
      }}
      onChange={(query) => search(query)}
      shouldAutocomplete={false}
    />
  )
}

function formatUserLabel(user: UserLookupResult): string {
  const parts: string[] = []
  if (user.displayName) parts.push(user.displayName)
  if (user.navIdent) parts.push(user.navIdent)
  if (parts.length === 0) return 'Ukjent bruker'
  if (user.displayName && user.navIdent) {
    return `${user.displayName} (${user.navIdent})`
  }
  return parts.join(' – ')
}
