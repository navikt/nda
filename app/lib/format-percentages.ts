/**
 * Format a percentage value with 1 decimal, omitting the decimal for whole numbers.
 */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)
}

/**
 * Distribute percentages using the largest remainder method so they sum to exactly 100%.
 *
 * Each input count is converted to a percentage of the total, rounded to 1 decimal,
 * and adjusted so the displayed values always add up to 100.0%.
 *
 * Assumes `total` equals the sum of `counts` and all values are non-negative.
 *
 * Returns formatted strings (e.g. "99.6", "0.4", "0").
 */
export function formatPercentages(counts: number[], total: number): string[] {
  if (counts.length === 0) {
    return []
  }

  if (total === 0) {
    return counts.map(() => '0')
  }

  const rawValues = counts.map((c) => (c / total) * 100)
  const floored = rawValues.map((v) => Math.floor(v * 10) / 10)
  const remainders = rawValues.map((v) => v * 10 - Math.floor(v * 10))
  const diff = Math.round((100 - floored.reduce((a, b) => a + b, 0)) * 10)
  const indices = remainders.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r)
  const adjusted = [...floored]
  for (let j = 0; j < diff; j++) {
    adjusted[indices[j % indices.length].i] += 0.1
  }

  return adjusted.map(formatPercent)
}
