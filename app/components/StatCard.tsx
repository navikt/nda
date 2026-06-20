import { BodyShort, Box, Detail, Heading, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import styles from './StatCard.module.css'

type StatCardVariant = 'default' | 'success' | 'danger' | 'warning'

interface StatCardBaseProps {
  label: string
  value: string | number
  subtitle?: string
  variant?: StatCardVariant
  selected?: boolean
}

interface StatCardLinkProps extends StatCardBaseProps {
  to: string
  onClick?: never
}

interface StatCardButtonProps extends StatCardBaseProps {
  onClick: () => void
  to?: never
}

interface StatCardStaticProps extends StatCardBaseProps {
  to?: never
  onClick?: never
}

type StatCardProps = StatCardLinkProps | StatCardButtonProps | StatCardStaticProps

type BorderColor = 'neutral-subtle' | 'success-subtle' | 'danger-subtle' | 'warning-subtle' | 'accent'
type DataColor = 'success' | 'danger' | 'warning' | 'neutral' | 'accent' | 'info'

const variantColors: Record<StatCardVariant, { border: BorderColor; dataColor?: DataColor; textColor?: string }> = {
  default: { border: 'neutral-subtle' },
  success: { border: 'success-subtle', dataColor: 'success', textColor: 'var(--ax-text-success)' },
  danger: { border: 'danger-subtle', dataColor: 'danger', textColor: 'var(--ax-text-danger)' },
  warning: { border: 'warning-subtle', dataColor: 'warning', textColor: 'var(--ax-text-warning)' },
}

function StatCardContent({
  label,
  value,
  subtitle,
  variant = 'default',
  selected,
  compact,
}: StatCardBaseProps & { compact?: boolean }) {
  const { border, dataColor, textColor } = variantColors[variant]
  const borderColor: BorderColor = selected ? 'accent' : border

  return (
    <Box
      padding={compact ? 'space-12' : 'space-20'}
      borderRadius="8"
      background={compact ? 'sunken' : 'raised'}
      borderColor={borderColor}
      borderWidth={selected ? '2' : '1'}
      data-color={dataColor}
      className={styles.clickableCard}
    >
      <VStack gap="space-4">
        {compact ? (
          <Detail textColor="subtle">{label}</Detail>
        ) : (
          <BodyShort size="small" textColor="subtle">
            {label}
          </BodyShort>
        )}
        <Heading level="3" size="large" style={textColor ? { color: textColor } : undefined}>
          {value}
        </Heading>
        {subtitle && (
          <BodyShort size="small" textColor="subtle">
            {subtitle}
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}

export function StatCard(props: StatCardProps & { compact?: boolean }) {
  const { to, onClick, compact, ...rest } = props

  if (to) {
    return (
      <Link to={to} className={styles.statCardLink}>
        <StatCardContent {...rest} compact={compact} />
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={styles.statCardButton} aria-pressed={rest.selected}>
        <StatCardContent {...rest} compact={compact} />
      </button>
    )
  }

  return (
    <Box
      padding={compact ? 'space-12' : 'space-20'}
      borderRadius="8"
      background={compact ? 'sunken' : 'raised'}
      borderColor="neutral-subtle"
      borderWidth="1"
    >
      <VStack gap="space-4">
        {compact ? (
          <Detail textColor="subtle">{rest.label}</Detail>
        ) : (
          <BodyShort size="small" textColor="subtle">
            {rest.label}
          </BodyShort>
        )}
        <Heading level="3" size="large">
          {rest.value}
        </Heading>
        {rest.subtitle && (
          <BodyShort size="small" textColor="subtle">
            {rest.subtitle}
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}
