import { t } from '$lib/i18n/t';
import { validRequestId } from '$lib/error-request-id';
import type { ApplyPreview } from './types';

/** The UI's limit on one apply. The server decides; this only refuses a 51st pick early. */
export const BULK_CAP = 50;

export type BulkTarget = { id: string; name: string; urn: string };
export type BulkError = { code: string; message: string; currentRevision: number | null; requestId: string | null };
export type BulkEntry = { index: number; memoryRef: string; ok: boolean; result: ApplyPreview | null; error: BulkError | null };
export type BulkResult = { dryRun: boolean; results: BulkEntry[]; succeeded: number; failed: number };
export type BulkRefusal = { kind: 'refused'; error: string; code: string | null; max?: number; count?: number };
/**
 * Three answers, kept apart on purpose. `result` and `refused` are facts. `unknown`
 * means no answer arrived: each target commits in its own transaction, so any
 * prefix of the list may have been applied and nothing here may say otherwise.
 */
export type BulkOutcome = { kind: 'result'; value: BulkResult } | BulkRefusal | { kind: 'unknown' };

const isOptionalText = (value: unknown) => value === null || typeof value === 'string';
const isOptionalTextOrMissing = (value: unknown) => value === undefined || isOptionalText(value);
function previewIsLegal(result: ApplyPreview | null, dryRun: boolean): boolean {
  return !!result && result.dryRun === dryRun && Number.isInteger(result.templateRevision) && typeof result.required === 'boolean'
    && Array.isArray(result.entries) && result.entries.every(entry => typeof entry?.role === 'string' && typeof entry.outcome === 'string')
    && Array.isArray(result.warnings) && result.warnings.every(warning => typeof warning?.code === 'string' && typeof warning.role === 'string' && isOptionalText(warning.field) && isOptionalTextOrMissing(warning.taskUrn) && isOptionalTextOrMissing(warning.taskState));
}
function errorIsLegal(error: BulkError | null): boolean {
  return !!error && typeof error.code === 'string' && typeof error.message === 'string'
    && (error.currentRevision === null || Number.isInteger(error.currentRevision)) && isOptionalText(error.requestId);
}
function entryIsLegal(entry: BulkEntry, index: number, ref: string, dryRun: boolean): boolean {
  if (entry?.index !== index || entry.memoryRef !== ref) return false;
  return entry.ok === true ? entry.error === null && previewIsLegal(entry.result, dryRun) : entry.ok === false && entry.result === null && errorIsLegal(entry.error);
}
/** A row this page can't trust could still be a committed write, so one bad row makes the whole answer unknown. */
function resultIsLegal(value: BulkResult | undefined, memoryRefs: string[], dryRun: boolean): value is BulkResult {
  if (!value || value.dryRun !== dryRun || !Array.isArray(value.results) || value.results.length !== memoryRefs.length) return false;
  if (!value.results.every((entry, index) => entryIsLegal(entry, index, memoryRefs[index], dryRun))) return false;
  const succeeded = value.results.filter(entry => entry.ok).length;
  return value.succeeded === succeeded && value.failed === value.results.length - succeeded;
}

/**
 * Only a 4xx carrying the route's JSON refusal proves the call wrote nothing, and
 * only a well-formed result can be reported row by row. Everything else is unknown.
 */
export async function bulkCall(body: { ref: string; memoryRefs: string[]; op: 'preview' | 'apply'; revision?: number }): Promise<BulkOutcome> {
  let response: Response, payload: { value?: BulkResult; error?: unknown; code?: unknown; max?: unknown; count?: unknown } | null;
  try {
    response = await fetch('/api/memory-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'bulk', ...body }), cache: 'no-store' });
    payload = await response.json();
  } catch { return { kind: 'unknown' }; }
  if (response.ok) return resultIsLegal(payload?.value, body.memoryRefs, body.op === 'preview') ? { kind: 'result', value: payload!.value! } : { kind: 'unknown' };
  if (response.status >= 500 || typeof payload?.error !== 'string') return { kind: 'unknown' };
  return { kind: 'refused', error: payload.error, code: typeof payload.code === 'string' ? payload.code : null,
    ...(typeof payload.max === 'number' ? { max: payload.max } : {}), ...(typeof payload.count === 'number' ? { count: payload.count } : {}) };
}

/** The one revision every `ok` row received, or null when there is none to bind. */
export function sharedRevision(results: BulkEntry[]): number | null {
  const revisions = new Set(results.flatMap(entry => entry.ok && entry.result ? [entry.result.templateRevision] : []));
  return revisions.size === 1 ? [...revisions][0] : null;
}

/**
 * Positions "Retry failed" may send again. A succeeded row is excluded because
 * re-sending it under a required template replaces its rule again; a
 * DUPLICATE_TARGET row because its memory belongs to the earlier position.
 */
export function retryPositions(results: BulkEntry[]): number[] {
  return results.flatMap((entry, index) => !entry.ok && entry.error?.code !== 'DUPLICATE_TARGET' ? [index] : []);
}

/**
 * How many ok rows the call actually changes. A row whose every rule is skipped
 * is ok (hrn:node:hadronmemory.com:specs:cor:api:290:01: skips are outcomes of a successful apply) but changes
 * nothing, so the summary splits succeeded into change and skipped. A row with
 * any APPLIED or REPLACED entry counts as changing, skips alongside it or not.
 */
export function changeSplit(results: BulkEntry[]): { change: number; skipped: number } {
  let change = 0;
  for (const entry of results) {
    if (entry.ok && (entry.result?.entries ?? []).some(e => e.outcome === 'APPLIED' || e.outcome === 'REPLACED')) change++;
  }
  return { change, skipped: results.filter(entry => entry.ok).length - change };
}

export function wholeCallCopy(refusal: BulkRefusal): string {
  if (refusal.code === 'CONFLICT') return t('config.bulk.template-changed', 'This template changed, so nothing was applied. Preview again before applying.');
  if (refusal.code === 'BULK_TARGETS_TOO_MANY' && refusal.max !== undefined && refusal.count !== undefined) return t('config.bulk.too-many', 'Too many memories: {count} chosen, and one apply takes at most {max}. Nothing was changed.', { count: refusal.count, max: refusal.max });
  return refusal.error;
}

export function rowErrorCopy(error: BulkError): string {
  switch (error.code) {
    case 'MEMORY_NOT_FOUND': return t('config.bulk.not-found', 'Not found, or you can’t manage it.');
    case 'DUPLICATE_TARGET': return t('config.bulk.duplicate', 'Already in the list. The earlier row took this memory.');
    case 'URN_NOT_QUALIFIED':
    case 'BAD_USER_INPUT': return t('config.bulk.malformed', 'This reference is malformed.');
    case 'CONFLICT': return error.currentRevision === null
      ? t('config.bulk.concurrent', 'A concurrent change got in the way. You can retry this memory.')
      : t('config.bulk.row-template-changed', 'The template changed, so it was not applied here. It is now at revision {revision}.', { revision: error.currentRevision });
    case 'INTERNAL_SERVER_ERROR': {
      const id = validRequestId(error.requestId);
      return id ? `${t('error.internal', 'Something went wrong on our side.')} ${t('error.request-id', 'Request ID: {id}', { id })}` : t('error.internal', 'Something went wrong on our side.');
    }
    default: return t('config.bulk.refused', 'Not applied: {message}', { message: error.message });
  }
}
