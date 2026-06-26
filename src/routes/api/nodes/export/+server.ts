import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_EXPORT_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';

// Node export (#421). Browser → this endpoint → hadron-server `nodeExport`,
// which is the single source of truth for the file format (byte-identical to
// `hadron node export`). The portal NEVER re-implements the codec — it forwards
// the request and serves the rendered bytes back. GraphQL only runs server-side
// (token in locals), same as /api/nodes/search.

interface NodeExportResult {
  format: string;
  mimeType: string;
  filename: string;
  encoding: string;
  data: string;
  bytes: number;
}

const FORMATS = new Set(['MD', 'JSON', 'PDF']);
const SECTIONS = new Set(['METADATA', 'CONTENT', 'ABSTRACT', 'DATA', 'PROPERTIES', 'EDGES']);

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Guard the parse: an empty / malformed JSON payload would otherwise throw
  // and surface as a generic 500. Treat it as a client error (400).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return json({ error: 'Missing node id' }, { status: 400 });
  const format = typeof payload.format === 'string' && FORMATS.has(payload.format) ? payload.format : 'MD';
  const full = payload.full !== false; // default true (canonical)
  // `sections` only applies to a presentation (full:false) export; the server
  // ignores it otherwise. Filter to known enum values so a bad client can't
  // push an invalid enum into the query.
  const sections =
    !full && Array.isArray(payload.sections)
      ? payload.sections.filter((s: unknown): s is string => typeof s === 'string' && SECTIONS.has(s))
      : undefined;

  try {
    const data = await gqlClient(locals.token).request<{ nodeExport: NodeExportResult }>(
      NODE_EXPORT_QUERY,
      { id, format, full, sections },
    );
    return json(data.nodeExport);
  } catch (e: unknown) {
    // Log detail server-side; return a generic message (mirrors /api/nodes/search).
    console.error('[/api/nodes/export] failed:', e);
    return json({ error: 'Export failed' }, { status: 500 });
  }
};
