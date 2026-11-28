// portal#1700: the Nodes tab's client half of its two paging doors (see
// src/routes/app/memories/[id]/nodes/{children,page}/+server.ts). Never
// rejects: null means the page could not be read (a rejected fetch, a non-OK
// status, a `{ failed: true }` answer or a payload that is not a page), and the
// caller keeps what it already shows and offers the same read again.
import type { MemoryNode } from '$lib/types';

export type NodesPage = { rows: MemoryNode[]; hasMore: boolean };

/** The server refused the reader's own pattern (regex mode): the reader's to fix, not a retry. */
export type InvalidPattern = 'invalid';

async function readPage(url: string, signal?: AbortSignal): Promise<NodesPage | InvalidPattern | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { rows?: unknown; hasMore?: unknown; invalid?: unknown } | null;
    if (body && body.invalid === true) return 'invalid';
    if (!body || !Array.isArray(body.rows) || typeof body.hasMore !== 'boolean') return null;
    const valid = body.rows.every(
      (r) => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && typeof (r as { loc?: unknown }).loc === 'string',
    );
    return valid ? { rows: body.rows as MemoryNode[], hasMore: body.hasMore } : null;
  } catch {
    return null;
  }
}

export const readTreePage = async (memoryRef: string, parentLoc: string, offset: number, signal?: AbortSignal): Promise<NodesPage | null> => {
  const page = await readPage(`/app/memories/${encodeURIComponent(memoryRef)}/nodes/children?parent=${encodeURIComponent(parentLoc)}&offset=${offset}`, signal);
  return page === 'invalid' ? null : page;
};

/** What the reader asked the Nodes tab to narrow by; empty means the plain paged list. */
export interface TableCriteria {
  q: string;
  /** q is a pattern (server mode regex). Only ever true with a q. */
  regex: boolean;
  types: string[];
  tags: string[];
  /** '' = any time. */
  changed: '' | '24h' | '7d' | '30d';
  /** The signed-in user's own nodes; the server reads the user from the token. */
  mine: boolean;
  /** '' = content only (the default); the server reads comments through contentScope. */
  scope: '' | 'comments' | 'all';
  /** '' = the default order. */
  sort: '' | 'loc' | 'updated' | 'relevance';
}

export const NO_CRITERIA: TableCriteria = { q: '', regex: false, types: [], tags: [], changed: '', mine: false, scope: '', sort: '' };

export const hasCriteria = (c: TableCriteria): boolean =>
  c.q !== '' || c.types.length > 0 || c.tags.length > 0 || c.changed !== '' || c.mine || c.scope !== '' || c.sort !== '';

export function tableQuery(c: TableCriteria): string {
  const p = new URLSearchParams();
  if (c.q) p.set('q', c.q);
  if (c.q && c.regex) p.set('mode', 'regex');
  for (const t of c.types) p.append('type', t);
  for (const t of c.tags) p.append('tag', t);
  if (c.changed) p.set('changed', c.changed);
  if (c.mine) p.set('mine', '1');
  if (c.scope) p.set('scope', c.scope);
  if (c.sort) p.set('sort', c.sort);
  const s = p.toString();
  return s ? `&${s}` : '';
}

export const readTablePage = (memoryRef: string, offset: number, signal?: AbortSignal, criteria: TableCriteria = NO_CRITERIA) =>
  readPage(`/app/memories/${encodeURIComponent(memoryRef)}/nodes/page?offset=${offset}${tableQuery(criteria)}`, signal);

/** Append `incoming` to `rows`, dropping any id already shown (offset paging can repeat rows). */
export function appendUnique<T extends { id: string }>(rows: T[], incoming: T[]): T[] {
  const seen = new Set(rows.map((r) => r.id));
  const out = rows.slice();
  for (const r of incoming) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
