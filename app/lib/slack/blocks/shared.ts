export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  if (maxLength <= 0) return ''
  const ellipsis = '...'.slice(0, maxLength)
  const cutoff = Math.max(0, maxLength - ellipsis.length)
  return `${text.substring(0, cutoff)}${ellipsis}`
}
