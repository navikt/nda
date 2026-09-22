import { ChevronLeftIcon, ChevronRightIcon } from '@navikt/aksel-icons'
import { BodyShort, Button, HStack, Select } from '@navikt/ds-react'
import { PER_PAGE_OPTIONS } from '~/lib/pagination'

interface PaginationControlsProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  perPage?: number
  onPerPageChange?: (perPage: number) => void
}

export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  perPage,
  onPerPageChange,
}: PaginationControlsProps) {
  const showPerPage = perPage !== undefined && onPerPageChange !== undefined
  if (totalPages <= 1 && !showPerPage) return null

  return (
    <HStack gap="space-16" justify="center" align="center" wrap>
      {totalPages > 1 && (
        <>
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronLeftIcon aria-hidden />}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Forrige
          </Button>
          <BodyShort>
            Side {page} av {totalPages}
          </BodyShort>
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronRightIcon aria-hidden />}
            iconPosition="right"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Neste
          </Button>
        </>
      )}
      {showPerPage && (
        <Select
          label="Antall per side"
          size="small"
          value={String(perPage)}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          hideLabel
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} per side
            </option>
          ))}
        </Select>
      )}
    </HStack>
  )
}
