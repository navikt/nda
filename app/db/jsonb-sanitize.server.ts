function stripNulBytes(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value
  }
  if (Array.isArray(value)) {
    return value.map(stripNulBytes)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, stripNulBytes(val)]))
  }
  return value
}

export function stringifyForJsonbColumn(value: unknown): string {
  return JSON.stringify(stripNulBytes(value))
}
