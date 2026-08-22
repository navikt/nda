import type { RestEndpointMethodTypes } from '@octokit/rest'
import type { CheckRun } from './pr/checks.server'

export const CHECKS_SNAPSHOT_SCHEMA_VERSION = 1

export type RawCheckAnnotation = RestEndpointMethodTypes['checks']['listAnnotations']['response']['data'][number]

export type RawCheckRun = RestEndpointMethodTypes['checks']['listForRef']['response']['data']['check_runs'][number] & {
  annotations: RawCheckAnnotation[] | null
  annotationsFetchFailed?: boolean
}

export interface ChecksSnapshotData {
  schemaVersion: typeof CHECKS_SNAPSHOT_SCHEMA_VERSION
  githubApiVersion?: string
  checkRuns: RawCheckRun[]
}

export function mapRawCheckRunToCheckRun(raw: RawCheckRun): CheckRun {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    conclusion: raw.conclusion,
    started_at: raw.started_at,
    completed_at: raw.completed_at,
    html_url: raw.html_url,
    head_sha: raw.head_sha,
    details_url: raw.details_url,
    external_id: raw.external_id,
    check_suite_id: raw.check_suite?.id ?? null,
    app: raw.app ? { name: raw.app.name, slug: raw.app.slug ?? null } : null,
    output: raw.output
      ? {
          title: raw.output.title,
          summary: raw.output.summary,
          text: raw.output.text,
          annotations_count: raw.output.annotations_count,
        }
      : null,
    annotations: raw.annotations
      ? raw.annotations.map((a) => ({
          path: a.path ?? null,
          start_line: a.start_line,
          end_line: a.end_line,
          start_column: a.start_column ?? null,
          end_column: a.end_column ?? null,
          annotation_level: a.annotation_level ?? 'notice',
          message: a.message ?? '',
          title: a.title ?? null,
          raw_details: a.raw_details ?? null,
        }))
      : null,
  }
}

export function computeChecksPassed(checkRuns: RawCheckRun[]): boolean | null {
  if (checkRuns.length === 0) return null
  if (checkRuns.some((check) => check.status !== 'completed')) return null
  return checkRuns.every((check) => check.conclusion === 'success' || check.conclusion === 'skipped')
}

export function isChecksResultDefinitive(checkRuns: RawCheckRun[]): boolean {
  return checkRuns.length === 0 || checkRuns.every((check) => check.status === 'completed')
}

export function parseCheckRunsSnapshot(data: unknown): { checks_passed: boolean | null; checks: CheckRun[] } | null {
  if (!data || typeof data !== 'object' || !('schemaVersion' in data) || !('checkRuns' in data)) {
    return null
  }

  const snapshot = data as ChecksSnapshotData

  switch (snapshot.schemaVersion) {
    case 1: {
      const checkRuns = snapshot.checkRuns
      return {
        checks_passed: computeChecksPassed(checkRuns),
        checks: checkRuns.map(mapRawCheckRunToCheckRun),
      }
    }
    default:
      return null
  }
}
