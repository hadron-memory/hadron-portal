import { t } from '$lib/i18n/t';
import { gitFailureMessage } from '$lib/sync-error';

// Closed v1/v2 public vocabulary, hrn:node:hadronmemory.com:specs:cor:int:010:01. Unknown values invalidate the
// whole report. Never return the parsed object or arbitrary diagnostic fields.
const v1Codes = {
  protected: ['PROTECTED_LOC', 'PROTECTED_COMMENT', 'PROTECTED_BOOT_PROMPT', 'PROTECTED_DECISION'],
  object_type_rejected: ['OBJECT_TYPE_REJECTED'],
  undeclared_role: ['ROLE_NOT_DECLARED'],
  invalid_include: ['INVALID_INCLUDE', 'INCLUDE_CYCLE', 'INCLUDE_TARGET_UNAVAILABLE'],
  deferred: ['ROW_CHANGED'],
  held_move: ['MOVE_HELD', 'DESTINATION_PROTECTED'],
} as const;
const v2Codes = {
  ...v1Codes,
  attestation_refused: ['AUTHORING_ATTESTATION_MISSING', 'AUTHORING_ATTESTATION_WRONG_TASK', 'AUTHORING_ATTESTATION_STALE', 'AUTHOR_TASK_BROKEN'],
} as const;
export type SyncReportKind = keyof typeof v2Codes;

export function syncReportKindLabel(kind: SyncReportKind): string {
  switch (kind) {
    case 'protected': return t('sync-report.kind-label.protected', 'Protected');
    case 'object_type_rejected': return t('sync-report.kind-label.object-type-rejected', 'Object type rejected');
    case 'undeclared_role': return t('sync-report.kind-label.undeclared-role', 'Undeclared role');
    case 'invalid_include': return t('sync-report.kind-label.invalid-include', 'Invalid include');
    case 'deferred': return t('sync-report.kind-label.deferred', 'Deferred');
    case 'held_move': return t('sync-report.kind-label.held-move', 'Move held');
    case 'attestation_refused': return t('sync-report.kind-label.attestation-refused', 'Attestation refused');
  }
}
export interface SyncReportEntry { kind: SyncReportKind; loc: string; fromLoc?: string; code: string }
export type SyncReportState = 'partial' | 'unknown' | 'failed' | 'clean' | 'not_synced' | 'unavailable';
export interface SyncReportView {
  state: SyncReportState;
  entries: SyncReportEntry[];
  recordedAt?: string;
  code?: 'SYNC_FAILED' | 'BAD_USER_INPUT';
}
export interface SyncOutcomeFields {
  lastSyncReport?: string | null;
  syncStatus?: string | null;
  lastSyncedAt?: string | null;
  syncError?: string | null;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Require an actual ISO UTC instant, including a real calendar date. */
export function isSyncInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, ms: string | undefined) => `.${(ms ?? '').padEnd(3, '0')}Z`);
  return parsed.toISOString() === normalized;
}
const safeSourceText = (value: string) => !/(?:[a-z][a-z0-9+.-]*:\/\/|gh[oprsu]_|github_pat_|hdr_(?:app|usr)_|Bearer\s)/i.test(value);
const boundedLoc = (value: string) => {
  const points = Array.from(value);
  return points.length <= 240 ? value : `${points.slice(0, 239).join('')}…`;
};

export function parseSyncReport(raw: unknown, status?: string | null, completedAt?: string | null): SyncReportView {
  const unavailable: SyncReportView = { state: 'unavailable', entries: [] };
  if (raw === null) {
    if (completedAt != null && !isSyncInstant(completedAt)) return unavailable;
    return { state: status === 'OK' && isSyncInstant(completedAt) ? 'clean' : 'not_synced', entries: [] };
  }
  if (typeof raw !== 'string') return unavailable;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || (value.version !== 1 && value.version !== 2) || typeof value.outcome !== 'string' || !['partial', 'unknown', 'failed'].includes(value.outcome) ||
        !isSyncInstant(value.recordedAt) || !Array.isArray(value.entries)) return unavailable;
    const codes: Partial<Record<SyncReportKind, readonly string[]>> = value.version === 1 ? v1Codes : v2Codes;
    if (value.outcome === 'failed') {
      if (value.entries.length !== 0 || (value.code !== 'SYNC_FAILED' && value.code !== 'BAD_USER_INPUT')) return unavailable;
      return { state: 'failed', recordedAt: value.recordedAt, code: value.code, entries: [] };
    }
    const entries: SyncReportEntry[] = [];
    for (const entry of value.entries) {
      if (!object(entry) || typeof entry.kind !== 'string' || !Object.hasOwn(codes, entry.kind) ||
          typeof entry.code !== 'string' || !(codes[entry.kind as SyncReportKind] as readonly string[]).includes(entry.code) ||
          typeof entry.loc !== 'string' || !safeSourceText(entry.loc) || (entry.fromLoc !== undefined && (typeof entry.fromLoc !== 'string' || !safeSourceText(entry.fromLoc)))) return unavailable;
      entries.push({ kind: entry.kind as SyncReportKind, loc: boundedLoc(entry.loc), code: entry.code,
        ...(typeof entry.fromLoc === 'string' ? { fromLoc: boundedLoc(entry.fromLoc) } : {}) });
    }
    return { state: value.outcome as 'partial' | 'unknown', recordedAt: value.recordedAt, entries };
  } catch {
    return unavailable;
  }
}

export function syncReportSummary(view: SyncReportView): string {
  switch (view.state) {
    case 'clean': return t('sync-report.clean', 'The completed sync applied everything.');
    case 'not_synced': return t('sync-report.not-synced', 'No clean completed sync is confirmed. Check the sync status and last-synced time.');
    case 'partial': return t('sync-report.partial', 'The sync succeeded with refused or deferred changes.');
    case 'unknown': return t('sync-report.unknown', 'The platform can’t confirm everything applied. Check the sync status and last-synced time.');
    case 'failed': return t('sync-report.failed', 'This recorded attempt failed; no committed files are reported.');
    default: return t('sync-report.unavailable', 'Report unavailable.');
  }
}
/** Both action paths share one parse and classification; error redaction stays separate. */
export function classifySyncOutcome(memory: SyncOutcomeFields | null | undefined): { view: SyncReportView; message: { type: 'success' | 'error'; text: string } } {
  const view = parseSyncReport(memory?.lastSyncReport, memory?.syncStatus, memory?.lastSyncedAt);
  return { view, message: messageForSyncOutcome(memory, view) };
}
export function syncOutcomeMessage(memory: SyncOutcomeFields | null | undefined): { type: 'success' | 'error'; text: string } {
  return classifySyncOutcome(memory).message;
}
function messageForSyncOutcome(memory: SyncOutcomeFields | null | undefined, view: SyncReportView): { type: 'success' | 'error'; text: string } {
  if (memory?.syncStatus === 'ERROR' || view.state === 'failed') {
    return { type: 'error', text: gitFailureMessage(memory?.syncError, 'sync') };
  }
  if (memory?.syncStatus !== 'OK') return { type: 'success', text: t('integrations.sync-not-finished', 'The sync didn’t finish (status: {status}). Check the status again shortly.', { status: safeSyncStatus(memory?.syncStatus) }) };
  if (view.state === 'partial') return { type: 'success', text: t('sync-report.action-partial', 'Synced with notes: {count} recorded outcomes need attention.', { count: view.entries.length }) };
  if (view.state === 'unknown' || view.state === 'unavailable') return { type: 'success', text: syncReportSummary(view) };
  if (view.state === 'clean') return { type: 'success', text: t('integrations.synced', 'Memory synced.') };
  return { type: 'success', text: syncReportSummary(view) };
}
export function safeSyncStatus(status: unknown): string {
  return typeof status === 'string' && ['PENDING', 'SYNCING', 'OK', 'ERROR'].includes(status) ? status : '—';
}
