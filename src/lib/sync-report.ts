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
  code?: 'SYNC_FAILED' | 'BAD_USER_INPUT' | 'OWNER_LIMIT_REACHED';
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
    if (!object(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3) || typeof value.outcome !== 'string' || !['partial', 'unknown', 'failed'].includes(value.outcome) ||
        !isSyncInstant(value.recordedAt) || !Array.isArray(value.entries)) return unavailable;
    const codes: Partial<Record<SyncReportKind, readonly string[]>> = value.version === 1 ? v1Codes : v2Codes;
    // Version 3 is read only as the failed limit report below; a version 3 report with entries stays unavailable.
    if (value.version === 3 && value.outcome !== 'failed') return unavailable;
    if (value.outcome === 'failed') {
      // The server writes a failed report as version 1 (SYNC_FAILED, BAD_USER_INPUT) or version 3 (OWNER_LIMIT_REACHED, #5015/#5019);
      // a code in any other version is one it never writes, so the report is not trusted.
      const code = value.code;
      const allowed = value.version === 3 ? code === 'OWNER_LIMIT_REACHED' : code === 'SYNC_FAILED' || code === 'BAD_USER_INPUT';
      if (value.entries.length !== 0 || !allowed) return unavailable;
      return { state: 'failed', recordedAt: value.recordedAt, code: code as 'SYNC_FAILED' | 'BAD_USER_INPUT' | 'OWNER_LIMIT_REACHED', entries: [] };
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
  // #2569 (C3-R7 a): a whole import refused for the owner's limit is stored as a typed marker. Fixed copy: the
  // stored `syncError` is not shown: stored text stays out of this view, while the thrown refusal is a typed server
  // message shown unchanged, like every other door's.
  if (view.state === 'failed' && view.code === 'OWNER_LIMIT_REACHED') {
    return { type: 'error', text: t('sync-report.owner-limit', 'The sync was refused: the owner of this memory has reached a limit of their account.') };
  }
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
