export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const PROD_ENVIRONMENTS = new Set(['prod-fss', 'prod-gcp'])

export function validateProdEnvironment(env: string): Response | null {
  if (!PROD_ENVIRONMENTS.has(env)) {
    return jsonError(`Only production environments are supported (prod-fss, prod-gcp). Received: ${env}`, 400)
  }
  return null
}
