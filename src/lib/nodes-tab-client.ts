// portal#1700: the Nodes tab's client half of its two paging doors (see
// src/routes/app/memories/[id]/nodes/{children,page}/+server.ts). Never
// rejects: null means the page could not be read (a rejected fetch, a non-OK
// status, a `{ failed: true }` answer or a payload that is not a page), and the
// caller keeps what it already shows and offers the same read again.
import type { MemoryNode } from '$lib/types';

export type NodesPage = { rows: MemoryNode[]; hasMore: boolean };

async function readPage(url: string, signal?: AbortSignal): Promise<NodesPage | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { rows?: unknown; hasMore?: unknown } | null;
    if (!body || !Array.isArray(body.rows) || typeof body.hasMore !== 'boolean') return null;
    const valid = body.rows.every(
      (r) => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && typeof (r as { loc?: unknown }).loc === 'string',
    );
    return valid ? { rows: body.rows as MemoryNode[], hasMore: body.hasMore } : null;
  } catch {
    return null;
  }
}

export const readTreePage = (memoryRef: string, parentLoc: string, offset: number, signal?: AbortSignal) =>
  readPage(`/app/memories/${encodeURIComponent(memoryRef)}/nodes/children?parent=${encodeURIComponent(parentLoc)}&offset=${offset}`, signal);

export const readTablePage = (memoryRef: string, offset: number, signal?: AbortSignal, search?: string) =>
  readPage(`/app/memories/${encodeURIComponent(memoryRef)}/nodes/page?offset=${offset}${search ? `&q=${encodeURIComponent(search)}` : ''}`, signal);

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
