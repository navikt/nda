export const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const

export const DEFAULT_PER_PAGE = 20

export function parsePerPage(value: string | null | undefined): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return DEFAULT_PER_PAGE
  return (PER_PAGE_OPTIONS as readonly number[]).includes(parsed) ? parsed : DEFAULT_PER_PAGE
}
