/**
 * portal#1174 — the Nodes tab's extra columns: Role, Last changed, Changed by,
 * Revision, Approved, Signed. They are NOT on the slim `memoryNodes` rows that
 * feed the layout (and must not be added there: every memory page would pay for
 * them), so the tab reads them lazily, in batches of the server's `nodeBatch`
 * cap, after the list is on screen. Pure: no fetching of its own, no DOM.
 */

import { approvalText, approvalView, type NodeApprovalState } from '$lib/node-approval';
import { signatureStateLabel } from '$lib/node-signatures';

/** hadron-server's `nodeBatch` refuses more refs than this rather than truncating. */
export const COLUMN_BATCH = 200;

export interface ColumnActor {
  id: string;
  name: string;
  urn: string | null;
}

/** Only the server's public revision-editor projection; no email or display name. */
export interface ColumnUser {
  handle: string | null;
  urn: string | null;
}

export interface NodeColumnRow {
  id: string;
  role: string | null;
  updatedAt: string | null;
  revision: number | null;
  /** Null when the server did not say; never read as "not approved". */
  approval: NodeApprovalState | null;
  /** The best signature state, null when the node carries none. */
  signature: string | null;
  /** Absent/null for older responses or no readable recorded human; never inferred from authorship. */
  user?: ColumnUser | null;
  agent: ColumnActor | null;
  worker: ColumnActor | null;
}

export function chunkIds(ids: readonly string[], size: number = COLUMN_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export interface ColumnChunk {
  rows: NodeColumnRow[];
  /** Ids the server would not return (denied or gone). */
  unavailable: string[];
  /** Ids the server dropped to stay under its response-size cap: failed, not absent. */
  omitted?: string[];
  /** Whether the deployment offers signing; false means the Signed column has nothing to say. */
  signing?: boolean;
}

export interface ColumnLoad {
  rows: Record<string, NodeColumnRow>;
  /** Ids in chunks that failed to load. They stay absent, never guessed. */
  failed: number;
  /** Ids the server would not return (denied or gone). */
  unavailable: number;
}

/**
 * Load the columns for every id, one chunk at a time. A chunk that throws is
 * counted in `failed` and the rest still land, so one bad batch costs its own
 * rows only. `onProgress` gets the number of ids settled so far (loaded or
 * failed); an aborted signal stops before the next chunk.
 */
export async function loadNodeColumns(
  ids: readonly string[],
  fetchChunk: (refs: string[]) => Promise<ColumnChunk>,
  opts: { signal?: AbortSignal; onProgress?: (settled: number) => void },
): Promise<ColumnLoad> {
  const out: ColumnLoad = { rows: {}, failed: 0, unavailable: 0 };
  let settled = 0;
  for (const refs of chunkIds(ids)) {
    if (opts.signal?.aborted) break;
    try {
      const chunk = await fetchChunk(refs);
      for (const r of chunk.rows) out.rows[r.id] = r;
      out.unavailable += chunk.unavailable.length;
      out.failed += chunk.omitted?.length ?? 0;
    } catch {
      out.failed += refs.length;
    }
    settled += refs.length;
    opts.onProgress?.(settled);
  }
  return out;
}

/** The shared approval wording; blank until the row has loaded or when the server said nothing. */
export function approvedCellText(row: NodeColumnRow | undefined): string {
  if (!row?.approval) return '';
  return approvalText(approvalView({ ok: true, value: { state: row.approval, approval: null } }));
}

/** Signed only for what the server derived; a node with no signature shows nothing, never "Not signed". */
export function signedCellText(row: NodeColumnRow | undefined): string {
  if (!row?.signature) return '';
  return signatureStateLabel(row.signature);
}

export interface ChangedByView {
  user: ColumnUser | null;
  worker: ColumnActor | null;
  agent: ColumnActor | null;
  /** Everything the cell shows, so the table filter finds it. */
  searchText: string;
}

export function changedByView(row: NodeColumnRow | undefined): ChangedByView {
  const user = row?.user ?? null;
  const worker = row?.worker ?? null;
  const agent = row?.agent ?? null;
  const searchText = [user?.handle, user?.urn, worker?.name, worker?.urn, agent?.name, agent?.urn].filter(Boolean).join(' ');
  return { user, worker, agent, searchText };
}
