export function parseId(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null
  const str = String(raw).trim()
  if (str === '') return null
  const n = Number(str)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
