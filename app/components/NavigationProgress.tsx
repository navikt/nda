import { Box } from '@navikt/ds-react'
import styles from './NavigationProgress.module.css'

export function NavigationProgress({ isNavigating }: { isNavigating: boolean }) {
  return (
    <Box role="status" aria-live="polite" aria-atomic="true">
      {isNavigating && (
        <>
          <Box as="span" className="aksel-sr-only">
            Laster side…
          </Box>
          <Box className={styles.track} aria-hidden="true">
            <Box className={styles.bar} />
          </Box>
        </>
      )}
    </Box>
  )
}
