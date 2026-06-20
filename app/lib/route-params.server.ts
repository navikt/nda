export function requireParams<K extends string>(
  params: Record<string, string | undefined>,
  keys: K[],
): Record<K, string> {
  const result = {} as Record<K, string>
  for (const key of keys) {
    const value = params[key]
    if (!value) {
      throw new Response(`Missing route parameter: ${key}`, { status: 400 })
    }
    result[key] = value
  }
  return result
}

export function requireTeamEnvParams(params: Record<string, string | undefined>) {
  return requireParams(params, ['team', 'env'])
}

export function requireTeamEnvAppParams(params: Record<string, string | undefined>) {
  return requireParams(params, ['team', 'env', 'app'])
}
