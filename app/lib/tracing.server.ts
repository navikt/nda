import { type Span, SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('deployment-audit')

export function getTraceId(): string | undefined {
  const span = trace.getActiveSpan()
  if (!span) return undefined
  const traceId = span.spanContext().traceId
  if (traceId === '00000000000000000000000000000000') return undefined
  return traceId
}

async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) })
      if (error instanceof Error) {
        span.recordException(error)
      }
      throw error
    } finally {
      span.end()
    }
  })
}

export async function withDbSpan<T>(operation: string, statement: string, fn: () => Promise<T>): Promise<T> {
  return withSpan(`db ${operation}`, async (span) => {
    span.setAttribute('db.system', 'postgresql')
    span.setAttribute('db.operation', operation)
    span.setAttribute('db.statement', statement.length > 500 ? `${statement.substring(0, 500)}…` : statement)
    return fn()
  })
}

export async function withGitHubSpan<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return withSpan(`github ${operation}`, async (span) => {
    span.setAttribute('http.url', 'https://api.github.com')
    span.setAttribute('peer.service', 'github')
    return fn()
  })
}
