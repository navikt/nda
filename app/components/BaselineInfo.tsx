import { BodyShort } from '@navikt/ds-react'

export function BaselineInfo() {
  return (
    <BodyShort>
      En baseline er den første sporbare leveransen for dette repositoriet etter at revisjonen startet i NDA — det
      finnes ingen tidligere leveranse i samme kodehistorikk å sammenligne mot. Den markerer startpunktet for
      revisjonen. Koden og endringen ved dette tidspunktet må manuelt bekreftes og godkjennes.
    </BodyShort>
  )
}
