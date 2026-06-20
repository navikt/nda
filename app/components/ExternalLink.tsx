import { ExternalLinkIcon } from '@navikt/aksel-icons'
import { Link as AkselLink } from '@navikt/ds-react'
import type { ComponentProps, ReactNode } from 'react'

type AkselLinkProps = ComponentProps<typeof AkselLink>

type Props = Omit<AkselLinkProps, 'target' | 'rel' | 'href'> & {
  href: string
  children: ReactNode
  hideIcon?: boolean
}

export function ExternalLink({ href, children, hideIcon, ...rest }: Props) {
  return (
    <AkselLink href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
      {!hideIcon && <ExternalLinkIcon aria-hidden fontSize="1em" />}
    </AkselLink>
  )
}
