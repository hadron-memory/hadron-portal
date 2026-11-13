import { t } from '$lib/i18n/t';
import { readReferences, REFERENCE_KINDS, referenceInput, type ReferenceKind, type TaskReference } from './references';

/**
 * portal#1643 (hadron-server#2663, hrn:node:hadronmemory.com:specs:cor:agt:050:30) —
 * the decision recorded for one finding of a finished task.
 *
 * The four codes are the server's closed `AgentTaskFindingDispositionCode`; EVERY
 * one resolves the finding, `deferred` included, and the latest write for a
 * finding replaces the earlier one (a disposition is never cleared). The optional
 * reference is the existing typed task reference, stored as given and never
 * resolved or fetched. Dispositions are a separate read from the immutable
 * findings, so a finding with no row here is "not disposed yet", but a failed
 * read of the rows is "unknown", never that.
 */
export const DISPOSITION_CODES = ['fixed', 'accepted', 'deferred', 'rejected'] as const;
export type DispositionCode = (typeof DISPOSITION_CODES)[number];

export interface FindingDisposition {
  findingId: string;
  /** The server's code. A code this portal does not know is shown as itself, never hidden. */
  disposition: string;
  reference: TaskReference | null;
}

/** The most dispositions one provider page may carry (default 20, max 200). */
export const DISPOSITIONS_PROVIDER_MAX = 200;
/** How many pages one read walks before it gives up as unknown rather than show a partial set. */
export const DISPOSITIONS_MAX_PAGES = 10;

export type DispositionsRead =
  | { kind: 'ok'; items: FindingDisposition[]; total: number }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

const isCode = (v: unknown): v is DispositionCode => typeof v === 'string' && (DISPOSITION_CODES as readonly string[]).includes(v);
const isKind = (k: unknown): k is ReferenceKind => typeof k === 'string' && (REFERENCE_KINDS as readonly string[]).includes(k);

export function dispositionLabel(code: string): string {
  switch (code) {
    case 'fixed': return t('app.tasks.disposition.fixed', 'Fixed');
    case 'accepted': return t('app.tasks.disposition.accepted', 'Accepted');
    case 'deferred': return t('app.tasks.disposition.deferred', 'Deferred');
    case 'rejected': return t('app.tasks.disposition.rejected', 'Rejected');
    default: return code;
  }
}

/**
 * One page of dispositions as the provider served it, checked at runtime. Null
 * means "treat as failed": a malformed page must never read as "nothing disposed".
 * A finding id appears once (the server keeps the latest), so a repeat is malformed.
 */
export function parseDispositionPage(value: unknown): { items: FindingDisposition[]; total: number; hasMore: boolean } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { items, total, hasMore } = value as Record<string, unknown>;
  if (!Array.isArray(items) || items.length > DISPOSITIONS_PROVIDER_MAX) return null;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null;
  if (typeof hasMore !== 'boolean') return null;
  if (hasMore && items.length === 0) return null;
  const seen = new Set<string>();
  const out: FindingDisposition[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const { findingId, disposition, reference } = item as Record<string, unknown>;
    if (typeof findingId !== 'string' || findingId === '' || typeof disposition !== 'string' || disposition === '') return null;
    if (seen.has(findingId)) return null;
    seen.add(findingId);
    let ref: TaskReference | null = null;
    if (reference !== null && reference !== undefined) {
      if (typeof reference !== 'object') return null;
      const { kind, target, label } = reference as Record<string, unknown>;
      if (!isKind(kind) || typeof target !== 'string' || target === '') return null;
      if (label !== null && label !== undefined && typeof label !== 'string') return null;
      ref = { kind, target, label: typeof label === 'string' && label !== '' ? label : null };
    }
    out.push({ findingId, disposition, reference: ref });
  }
  return { items: out, total, hasMore };
}

/** Findings keyed by id, for drawing a row. */
export function dispositionsById(items: readonly FindingDisposition[]): Map<string, FindingDisposition> {
  return new Map(items.map((d) => [d.findingId, d]));
}

export type DispositionInput =
  | { ok: true; vars: { findingId: string; disposition: DispositionCode; reference?: { kind: ReferenceKind; target: string; label?: string } } }
  | { ok: false; field: string; message: string };

/**
 * What the disposition form posted: the finding, one of the four codes, and at
 * most one reference. Targets and labels are sent exactly as typed; lengths and
 * shapes are the server's to refuse. Nothing is inferred about who may write.
 */
export function readDispositionForm(fd: FormData): DispositionInput {
  const findingId = String(fd.get('findingId') ?? '');
  if (findingId === '') return { ok: false, field: 'findingId', message: t('app.tasks.disposition.finding-required', 'Choose a finding.') };
  const code = fd.get('disposition');
  if (!isCode(code)) return { ok: false, field: 'disposition', message: t('app.tasks.disposition.code-required', 'Choose what happened to this finding.') };
  const raw = fd.get('references');
  const refs = raw === null ? [] : readReferences(raw);
  if (refs === null) return { ok: false, field: 'references', message: t('app.tasks.disposition.reference-unreadable', 'That reference couldn’t be read. Remove it and add it again.') };
  if (refs.length > 1) return { ok: false, field: 'references', message: t('app.tasks.disposition.one-reference', 'A disposition holds at most one reference.') };
  return { ok: true, vars: { findingId, disposition: code, ...(refs[0] ? { reference: referenceInput(refs[0]) } : {}) } };
}
