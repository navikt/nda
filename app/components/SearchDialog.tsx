import { MagnifyingGlassIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Detail, Dialog, HStack, Loader, Search, Tag, VStack } from '@navikt/ds-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

interface SearchResult {
  type: 'deployment' | 'user' | 'team' | 'app' | 'dev_team' | 'group'
  id?: number
  url: string
  title: string
  subtitle?: string
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as="kbd"
      paddingInline="space-6"
      paddingBlock="space-2"
      background="neutral-moderate"
      borderRadius="4"
      style={{
        fontFamily: 'inherit',
        fontSize: '0.75rem',
        fontWeight: 500,
      }}
    >
      {children}
    </Box>
  )
}

function resultTagVariant(type: SearchResult['type']): 'info' | 'neutral' | 'success' | 'warning' | 'moderate' {
  switch (type) {
    case 'deployment':
      return 'info'
    case 'team':
      return 'success'
    case 'app':
      return 'warning'
    case 'dev_team':
    case 'group':
      return 'moderate'
    default:
      return 'neutral'
  }
}

function resultTagLabel(type: SearchResult['type']): string {
  switch (type) {
    case 'deployment':
      return 'Leveranse'
    case 'user':
      return 'Bruker'
    case 'team':
      return 'Nais-team'
    case 'dev_team':
      return 'Utviklerteam'
    case 'app':
      return 'Applikasjon'
    case 'group':
      return 'Gruppe'
  }
}

export function SearchDialog() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<SearchResult[]>([])
  const selectedIndexRef = useRef(0)
  const navigate = useNavigate()
  const location = useLocation()

  resultsRef.current = results
  selectedIndexRef.current = selectedIndex

  // biome-ignore lint/correctness/useExhaustiveDependencies: We want this to run when pathname changes
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setResults([])
  }, [location.pathname])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return

    const handleArrowKeys = (e: KeyboardEvent) => {
      const currentResults = resultsRef.current
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, currentResults.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && currentResults.length > 0) {
        e.preventDefault()
        const result = currentResults[selectedIndexRef.current]
        if (result) {
          navigate(result.url)
          setOpen(false)
        }
      }
    }

    window.addEventListener('keydown', handleArrowKeys)
    return () => window.removeEventListener('keydown', handleArrowKeys)
  }, [open, navigate])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        if (response.ok) {
          const data = await response.json()
          setResults(data.results || [])
          setSelectedIndex(0)
        }
      } catch {
        // Ignore errors
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = useCallback(
    (result: SearchResult) => {
      navigate(result.url)
      setOpen(false)
    },
    [navigate],
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <Dialog.Trigger>
        <HStack
          gap="space-8"
          align="center"
          style={{
            cursor: 'pointer',
            minWidth: '200px',
            padding: 'var(--ax-space-6) var(--ax-space-12)',
            background: 'var(--ax-bg-neutral-softA)',
            borderRadius: 'var(--ax-radius-8)',
            border: '1px solid var(--ax-border-neutral-subtle)',
          }}
        >
          <MagnifyingGlassIcon aria-hidden style={{ fontSize: '1rem', color: 'var(--ax-text-neutral-subtle)' }} />
          <BodyShort size="small" style={{ color: 'var(--ax-text-neutral-subtle)', flex: 1 }}>
            Søk...
          </BodyShort>
          <Kbd>⌘K</Kbd>
        </HStack>
      </Dialog.Trigger>

      <Dialog.Popup
        width="large"
        position="center"
        closeOnOutsideClick
        initialFocusTo={() => searchInputRef.current}
        aria-label="Søk"
      >
        <Dialog.Header withClosebutton={false}>
          <Search
            ref={searchInputRef}
            label="Søk"
            hideLabel
            variant="simple"
            placeholder="Søk på team, applikasjon, navn, NAV-ident, SHA..."
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />
        </Dialog.Header>

        <Dialog.Body style={{ padding: 0, maxHeight: '400px', overflowY: 'auto' }}>
          {loading && (
            <HStack justify="center" padding="space-24">
              <Loader size="medium" />
            </HStack>
          )}

          {!loading && query && results.length === 0 && (
            <Box padding="space-24">
              <BodyShort style={{ color: 'var(--ax-text-neutral-subtle)', textAlign: 'center' }}>
                Ingen resultater for "{query}"
              </BodyShort>
            </Box>
          )}

          {!loading && results.length > 0 && (
            <Box paddingInline="space-12" paddingBlock="space-8">
              <VStack as="ul" gap="space-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {results.map((result, index) => {
                  const isSelected = index === selectedIndex
                  return (
                    <Box
                      as="li"
                      key={`${result.type}-${result.id || result.title}`}
                      padding="space-12"
                      paddingInline="space-16"
                      borderRadius="4"
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--ax-bg-accent-moderate-pressed)' : undefined,
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => handleSelect(result)}
                    >
                      <Link
                        to={result.url}
                        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                        onClick={(e) => {
                          e.preventDefault()
                          handleSelect(result)
                        }}
                      >
                        <HStack gap="space-12" align="center">
                          <MagnifyingGlassIcon
                            aria-hidden
                            style={{ fontSize: '1rem', color: 'var(--ax-text-neutral-subtle)' }}
                          />
                          <VStack gap="space-2" style={{ flex: 1, minWidth: 0 }}>
                            <HStack gap="space-8" align="center">
                              <BodyShort
                                weight="semibold"
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {result.title}
                              </BodyShort>
                              <Tag size="xsmall" variant={resultTagVariant(result.type)}>
                                {resultTagLabel(result.type)}
                              </Tag>
                            </HStack>
                            {result.subtitle && (
                              <BodyShort
                                size="small"
                                style={{
                                  color: 'var(--ax-text-neutral-subtle)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {result.subtitle}
                              </BodyShort>
                            )}
                          </VStack>
                        </HStack>
                      </Link>
                    </Box>
                  )
                })}
              </VStack>
            </Box>
          )}

          {!loading && !query && (
            <Box padding="space-24">
              <VStack gap="space-8" align="center">
                <BodyShort style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                  Søk på team, applikasjon, navn, NAV-ident, GitHub-brukernavn, SHA eller deployment ID
                </BodyShort>
                <HStack gap="space-8">
                  <HStack gap="space-4" align="center">
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    <Detail>naviger</Detail>
                  </HStack>
                  <HStack gap="space-4" align="center">
                    <Kbd>↵</Kbd>
                    <Detail>velg</Detail>
                  </HStack>
                  <HStack gap="space-4" align="center">
                    <Kbd>esc</Kbd>
                    <Detail>lukk</Detail>
                  </HStack>
                </HStack>
              </VStack>
            </Box>
          )}
        </Dialog.Body>
      </Dialog.Popup>
    </Dialog>
  )
}
