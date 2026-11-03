/**
 * portal#1649 — the pure half of the action-register views.
 *
 * The server owns every count, state and order (hrn:node:hadronmemory.com:specs:cor:agt:110:03, hrn:node:hadronmemory.com:specs:cor:api:120:04);
 * this file only reads the URL's paging, labels a row by what it resolves to,
 * and says what one page may claim about the whole list.
 */

export const DEFAULT_LIMIT = 20;
/** The most rows the server serves for one page (hadron-server#3287): a larger limit is clamped there. */
export const MAX_LIMIT = 200;

export type EntryState = 'MAPPED' | 'UNRESOLVED' | 'UNMAPPED';

export interface RegisterEntry {
  code: string;
  state: EntryState;
  taskLoc: string | null;
  taskUrn: string | null;
  definedBy?: string | null;
  entryUrn?: string | null;
  actionUrn?: string | null;
}

export interface RegisterPage {
  entries: RegisterEntry[];
  total: number;
  hasMore: boolean;
}

const posInt = (raw: string | null): number | null => (raw !== null && /^[0-9]+$/.test(raw) ? Number(raw) : null);

/** A positive whole number, else the default. Above 200 is sent unchanged: the server clamps (the gate). */
export function parseLimit(raw: string | null): number {
  const n = posInt(raw);
  return n !== null && n > 0 ? n : DEFAULT_LIMIT;
}

/** A whole number from 0, else 0. Past the end is an empty page, not an error. */
export function parseOffset(raw: string | null): number {
  return posInt(raw) ?? 0;
}

export interface PageClaims {
  /** True only for the first page when the server says nothing follows. */
  wholeList: boolean;
  nextOffset: number | null;
  prevOffset: number | null;
}

export function pageClaims(p: { offset: number; limit: number; total: number; hasMore: boolean }): PageClaims {
  // The server serves at most MAX_LIMIT rows however much was asked, so a page
  // is that long: stepping by the asked limit (say 500) would skip rows 200-499.
  const step = Math.min(p.limit, MAX_LIMIT);
  return {
    wholeList: p.offset === 0 && !p.hasMore,
    nextOffset: p.hasMore ? p.offset + step : null,
    prevOffset: p.offset > 0 ? Math.max(0, p.offset - step) : null,
  };
}

export type RowKind = 'sends-here' | 'resolves-elsewhere' | 'mapped' | 'unresolved' | 'unmapped' | 'unknown';

/**
 * What a row resolves to. With a definition URN (the role view), only an
 * exact `taskUrn` match says "sends work here": a matching `taskLoc` proves
 * neither the exact node nor a runnable destination. Without one (the App
 * view) a MAPPED row is simply mapped.
 */
export function rowKind(e: Pick<RegisterEntry, 'state' | 'taskUrn'> & Partial<RegisterEntry>, definitionUrn: string | null): RowKind {
  if (e.state === 'MAPPED') {
    if (definitionUrn === null) return 'mapped';
    return e.taskUrn === definitionUrn ? 'sends-here' : 'resolves-elsewhere';
  }
  if (e.state === 'UNRESOLVED') return 'unresolved';
  if (e.state === 'UNMAPPED') return 'unmapped';
  return 'unknown';
}
