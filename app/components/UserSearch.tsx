import { UNSAFE_Combobox } from '@navikt/ds-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphUserResult } from '~/lib/microsoft-graph.server'

interface UserSearchProps {
  label?: string
  onSelect: (navIdent: string) => void
  onSelectUser?: (user: GraphUserResult) => void
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
  const [results, setResults] = useState<GraphUserResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
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
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          setResults([])
          return
        }
        const data = await response.json()
        if (!controller.signal.aborted) {
          setResults(data.results ?? [])
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setResults([])
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

function formatUserLabel(user: GraphUserResult): string {
  const parts: string[] = []
  if (user.displayName) parts.push(user.displayName)
  if (user.navIdent) parts.push(user.navIdent)
  if (parts.length === 0) return 'Ukjent bruker'
  if (user.displayName && user.navIdent) {
    return `${user.displayName} (${user.navIdent})`
  }
  return parts.join(' – ')
}
