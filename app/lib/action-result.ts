export type ActionResult = {
  success?: string
  error?: string
}

export function ok(message: string): ActionResult {
  return { success: message }
}

export function fail(message: string): ActionResult {
  return { error: message }
}
