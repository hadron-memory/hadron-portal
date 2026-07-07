/**
 * Extraction-spec and output-spec shapes for flow nodes (#478 phase 2),
 * shared by the node page's Flow tab (live validation) and its server
 * action (the save-time backstop).
 *
 * Server contract (spec 040 plan-multi-node): a node with
 * `data.extractionSpec: [{ field, description?, shape? }]` gets a
 * structured LLM call after it runs; extracted fields merge into the
 * run envelope and are addressable as `message.data.<field>`. Shapes
 * v1: number, boolean, string[] — anything else is treated as string.
 *
 * The server re-validates at save AND run time (reserved-names check in
 * hadron-server src/lib/edge-conditions/reserved-names.ts plus the
 * runner's `__` plumbing guard) — portal validation is UX, not the
 * security boundary, but it must reject the same names earlier with a
 * human message.
 */

export const EXTRACTION_SHAPES = ['string', 'number', 'boolean', 'string[]'] as const;
export type ExtractionShape = (typeof EXTRACTION_SHAPES)[number];

export interface ExtractionRow {
  field: string;
  shape: ExtractionShape;
  description: string;
}

export interface OutputSpec {
  /** Fully-qualified URN of the node the flow writes to mid-run. */
  writeTo: string;
  mode: 'replace' | 'append';
}

/**
 * Why one field name is unusable, or null when it's fine. Mirrors the
 * server's reserved-namespace rules with author-facing wording.
 */
export function extractionFieldError(field: string): string | null {
  const f = field.trim();
  if (f === '') return 'Field name is required.';
  for (const r of ['exception', 'exceptions']) {
    if (f === r || f.startsWith(r + '.') || f.startsWith(r + '[')) {
      return `“${r}” is reserved by the platform — pick a different name.`;
    }
  }
  if (f.startsWith('__')) {
    return 'Names starting with “__” are reserved for the platform — pick a different name.';
  }
  return null;
}

/**
 * Validate a whole editor row set: per-field rules plus duplicates.
 * Returns the first problem as `{ row, message }`, or null when clean.
 */
export function extractionRowsError(
  rows: ReadonlyArray<Pick<ExtractionRow, 'field'>>,
): { row: number; message: string } | null {
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const message = extractionFieldError(rows[i].field);
    if (message) return { row: i, message };
    const f = rows[i].field.trim();
    if (seen.has(f)) return { row: i, message: `“${f}” is listed twice — field names must be unique.` };
    seen.add(f);
  }
  return null;
}

/** Editor rows from stored node data, shape-tolerantly. */
export function rowsFromNodeData(data: unknown): ExtractionRow[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
  const spec = (data as Record<string, unknown>).extractionSpec;
  if (!Array.isArray(spec)) return [];
  return spec
    .filter(
      (e): e is { field: string; shape?: unknown; description?: unknown } =>
        e !== null && typeof e === 'object' && typeof (e as { field?: unknown }).field === 'string',
    )
    .map((e) => ({
      field: e.field,
      shape: EXTRACTION_SHAPES.includes(e.shape as ExtractionShape)
        ? (e.shape as ExtractionShape)
        : 'string',
      description: typeof e.description === 'string' ? e.description : '',
    }));
}

/** Stored spec entries from editor rows — omit empty descriptions and default shape. */
export function rowsToSpec(rows: ReadonlyArray<ExtractionRow>): Array<Record<string, string>> {
  return rows.map((r) => ({
    field: r.field.trim(),
    ...(r.shape !== 'string' ? { shape: r.shape } : {}),
    ...(r.description.trim() !== '' ? { description: r.description.trim() } : {}),
  }));
}

/** The stored output spec, shape-tolerantly; null when absent/malformed. */
export function outputFromNodeData(data: unknown): OutputSpec | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const output = (data as Record<string, unknown>).output;
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return null;
  const writeTo = (output as Record<string, unknown>).writeTo;
  if (typeof writeTo !== 'string' || writeTo.trim() === '') return null;
  const mode = (output as Record<string, unknown>).mode;
  return { writeTo, mode: mode === 'append' ? 'append' : 'replace' };
}
