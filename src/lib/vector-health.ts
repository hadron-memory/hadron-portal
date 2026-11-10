/**
 * portal#1346 — the "Vector index health" panel's read of `validateMemory`.
 *
 * The server has no check filter: `validateMemory(memoryRef, limit)` runs every
 * check and caps the COMBINED findings. So the panel asks for the most it may
 * (VECTOR_HEALTH_LIMIT), keeps EMBED_FAILED client-side, and says so when the
 * cap may have hidden some. Pure: no fetching, no DOM.
 */

/**
 * The server's maximum `limit`; its default is 200. `validateMemory` never refuses a limit, it
 * clamps it: `Math.min(Math.max(limit ?? 200, 0), 1000)` (hadron-server
 * src/api/graphql/schema/resolvers.query.memory.ts:196), so a larger value is served as 1000.
 */
export const VECTOR_HEALTH_LIMIT = 1000;

export interface ValidateMemoryResult {
  findings: Array<{ kind: string; nodeId: string; nodeLoc: string; nodeUrn: string | null; detail: string }>;
  /** Problems only — informational declarations are counted separately (server#2996, portal#1533). */
  totalFindings: number;
  /** Informational declarations (INDEX_TRUNCATED); never in `totalFindings`. */
  totalInformational: number;
  truncated: boolean;
  nodesChecked: number;
  skippedChecks: Array<{ check: string; reason: string }>;
}

export interface VectorHealthRow {
  nodeId: string;
  nodeLoc: string;
  /** Null when the server could not compose one; rendered as absent. */
  nodeUrn: string | null;
  /** The finding's `detail`: the reason, shown escaped. */
  detail: string;
}

export interface VectorHealthView {
  failed: VectorHealthRow[];
  /** Set when other check kinds may have crowded EMBED_FAILED rows out of `findings`. */
  truncation: { shown: number; total: number } | null;
  /** The skip reason when the EMBED_FAILED check did not run: an empty list then proves nothing. */
  skipped: string | null;
}

export function embedFailedView(res: ValidateMemoryResult): VectorHealthView {
  const failed = res.findings
    .filter((f) => f.kind === 'EMBED_FAILED')
    .map((f) => ({ nodeId: f.nodeId, nodeLoc: f.nodeLoc, nodeUrn: f.nodeUrn ?? null, detail: f.detail }));
  // The page holds problems and informational declarations; the true total is
  // both counts (the server's `truncated` uses the same sum). Counting only
  // `totalFindings` read as "showing N of 0" once it became problems-only
  // (server#2996, portal#1533).
  const total = res.totalFindings + res.totalInformational;
  const capped = res.truncated || total > res.findings.length;
  return {
    failed,
    truncation: capped ? { shown: res.findings.length, total } : null,
    skipped: res.skippedChecks.find((c) => c.check === 'EMBED_FAILED')?.reason ?? null,
  };
}
