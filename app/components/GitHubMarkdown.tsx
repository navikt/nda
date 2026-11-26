import { CheckmarkIcon, SquareIcon } from '@navikt/aksel-icons'
import { Alert, BodyLong, Box, Detail, Heading, ReadMore, Table } from '@navikt/ds-react'
import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import Markdown, { type Components, defaultUrlTransform } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { ExternalLink } from '~/components/ExternalLink'
import styles from './GitHubMarkdown.module.css'

const schema: Options = {
  ...defaultSchema,
  tagNames: [
    'a',
    'b',
    'blockquote',
    'br',
    'caption',
    'code',
    'del',
    'details',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'input',
    'kbd',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  attributes: {
    a: ['href', 'title'],
    code: [['className', /^language-[\w-]+$/]],
    img: ['alt'],
    input: [['type', 'checkbox'], ['disabled', true], 'checked'],
    ol: ['start'],
    td: ['align', 'colSpan', 'rowSpan'],
    th: ['align', 'colSpan', 'rowSpan', 'scope'],
  },
  protocols: { href: ['http', 'https', 'mailto'] },
  strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form'],
}

function summaryText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child) ? summaryText(child.props.children) : String(child),
    )
    .join('')
}

function MarkdownSummary({ children }: { children?: ReactNode }) {
  return children
}

function MarkdownParagraph({ children }: { children?: ReactNode }) {
  return <BodyLong>{children}</BodyLong>
}

function MarkdownQuote({ children }: { children?: ReactNode }) {
  const content = Children.toArray(children)
  const paragraph = content.find(
    (child) => isValidElement<{ children?: ReactNode }>(child) && child.type === MarkdownParagraph,
  )
  if (isValidElement<{ children?: ReactNode }>(paragraph)) {
    const paragraphContent = Children.toArray(paragraph.props.children)
    const first = paragraphContent[0]
    const marker = typeof first === 'string' ? first.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/) : null
    if (marker && typeof first === 'string') {
      const variant = marker[1] === 'WARNING' || marker[1] === 'CAUTION' ? 'warning' : 'info'
      return (
        <Alert variant={variant}>
          {content.map((child) =>
            child === paragraph
              ? cloneElement(paragraph, undefined, first.slice(marker[0].length), ...paragraphContent.slice(1))
              : child,
          )}
        </Alert>
      )
    }
  }
  return (
    <Box as="blockquote" paddingInline="space-16" className={styles.quote}>
      {children}
    </Box>
  )
}

function MarkdownDetails({ children }: { children?: ReactNode }) {
  const content = Children.toArray(children)
  const summary = content.find(
    (child) => isValidElement<{ children?: ReactNode }>(child) && child.type === MarkdownSummary,
  )
  const header = isValidElement<{ children?: ReactNode }>(summary) ? summaryText(summary.props.children) : ''

  return (
    <ReadMore header={header.trim() || 'Vis detaljer'} variant="moderate">
      <Box className={styles.detailsContent}>{content.filter((child) => child !== summary)}</Box>
    </ReadMore>
  )
}

function alignment(align?: string) {
  return align === 'center' || align === 'right' ? align : 'left'
}

const components: Components = {
  a: ({ children, href, title }) =>
    href ? (
      <ExternalLink href={href} title={title}>
        {children}
      </ExternalLink>
    ) : (
      children
    ),
  p: MarkdownParagraph,
  h1: ({ children }) => (
    <Heading level="3" size="medium">
      {children}
    </Heading>
  ),
  h2: ({ children }) => (
    <Heading level="3" size="medium">
      {children}
    </Heading>
  ),
  h3: ({ children }) => (
    <Heading level="3" size="small">
      {children}
    </Heading>
  ),
  h4: ({ children }) => (
    <Heading level="4" size="xsmall">
      {children}
    </Heading>
  ),
  h5: ({ children }) => (
    <Heading level="5" size="xsmall">
      {children}
    </Heading>
  ),
  h6: ({ children }) => (
    <Heading level="6" size="xsmall">
      {children}
    </Heading>
  ),
  blockquote: MarkdownQuote,
  pre: ({ children }) => (
    <Box as="pre" padding="space-16" background="neutral-moderate" borderRadius="8" className={styles.codeBlock}>
      {children}
    </Box>
  ),
  code: ({ children }) => <Box as="code">{children}</Box>,
  ul: ({ children }) => <Box as="ul">{children}</Box>,
  ol: ({ children, start }) => (
    <Box as="ol" start={start}>
      {children}
    </Box>
  ),
  li: ({ children }) => <Box as="li">{children}</Box>,
  hr: () => <Box as="hr" className={styles.separator} />,
  details: MarkdownDetails,
  summary: MarkdownSummary,
  img: ({ alt }) => (alt ? <Detail as="span">{alt}</Detail> : null),
  input: ({ checked }) => (
    <Detail as="span" className={styles.taskStatus}>
      {checked ? <CheckmarkIcon title="Fullført" /> : <SquareIcon title="Ikke fullført" />}
    </Detail>
  ),
  table: ({ children }) => (
    <Box className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tabell i PR-beskrivelsen">
      <Table size="small">{children}</Table>
    </Box>
  ),
  thead: ({ children }) => <Table.Header>{children}</Table.Header>,
  tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
  tfoot: ({ children }) => <Box as="tfoot">{children}</Box>,
  caption: ({ children }) => <Box as="caption">{children}</Box>,
  tr: ({ children }) => <Table.Row>{children}</Table.Row>,
  th: ({ children, align, colSpan, rowSpan, scope }) => (
    <Table.HeaderCell align={alignment(align)} colSpan={colSpan} rowSpan={rowSpan} scope={scope ?? 'col'}>
      {children}
    </Table.HeaderCell>
  ),
  td: ({ children, align, colSpan, rowSpan }) => (
    <Table.DataCell align={alignment(align)} colSpan={colSpan} rowSpan={rowSpan}>
      {children}
    </Table.DataCell>
  ),
}

export type GitHubMarkdownProps = {
  children: string
  sourceUrl?: string
}

export function GitHubMarkdown({ children, sourceUrl = 'https://github.com/' }: GitHubMarkdownProps) {
  return (
    <Box className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={components}
        urlTransform={(url) => {
          const safeUrl = defaultUrlTransform(url)
          if (!safeUrl) return ''
          try {
            const resolved = new URL(safeUrl, sourceUrl)
            return ['http:', 'https:', 'mailto:'].includes(resolved.protocol) ? resolved.href : ''
          } catch {
            return ''
          }
        }}
      >
        {children}
      </Markdown>
    </Box>
  )
}
