import { BodyShort } from '@navikt/ds-react'

/**
 * Shared explanation of what a baseline deployment is.
 * Rendered on both the deployment detail page and the app detail warning banner.
 * Keep consistent with the explanation in the PDF audit report.
 */
export function BaselineInfo() {
  return (
    <BodyShort>
      En baseline er den første leveransen etter at revisjonen av applikasjonen startet i NDA. Den markerer startpunktet
      for revisjonen. Koden og endringen ved dette tidspunktet må manuelt bekreftes og godkjennes.
    </BodyShort>
  )
}
