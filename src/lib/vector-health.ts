/**
 * portal#1346 — the "Vector index health" panel's read of `validateMemory`.
 *
 * The server has no check filter: `validateMemory(memoryRef, limit)` runs every
 * check and caps the COMBINED findings. So the panel asks for the most it may
 * (VECTOR_HEALTH_LIMIT), keeps EMBED_FAILED client-side, and says so when the
 * cap may have hidden some. Pure: no fetching, no DOM.
 */

/** The server's maximum `limit`; its default is 200. */
export const VECTOR_HEALTH_LIMIT = 1000;

export interface ValidateMemoryResult {
  findings: Array<{ kind: string; nodeId: string; nodeLoc: string; nodeUrn: string | null; detail: string }>;
  totalFindings: number;
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
  const capped = res.truncated || res.totalFindings > res.findings.length;
  return {
    failed,
    truncation: capped ? { shown: res.findings.length, total: res.totalFindings } : null,
    skipped: res.skippedChecks.find((c) => c.check === 'EMBED_FAILED')?.reason ?? null,
  };
}
