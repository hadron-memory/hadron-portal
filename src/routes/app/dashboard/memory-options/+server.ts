// #666: option rows for the usage-activity widget's scope picker. A separate,
// lazily-hit endpoint (the page fetches it when the user enters Customize) so
// the plain dashboard view never pays for the memory list — and unlike the
// original single capped page, it walks the caller's FULL readable set page by
// page (Codex on #666), bounded by a generous ceiling.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MEMORY_OPTIONS_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export interface MemoryOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 100;
/** Backstop against a pathological caller-readable set; flagged as truncated. */
const MAX_OPTIONS = 1000;

export const GET: RequestHandler = async ({ locals }) => {
  const options: MemoryOption[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  try {
    while (offset < total && options.length < MAX_OPTIONS) {
      const data = await gqlClient(locals.token).request<{
        memories: { items: MemoryOption[]; total: number };
      }>(MEMORY_OPTIONS_QUERY, { limit: PAGE_SIZE, offset });
      options.push(...data.memories.items.map(({ id, name }) => ({ id, name })));
      total = data.memories.total;
      if (data.memories.items.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  } catch (e) {
    // The picker degrades to "My activity" + the stored ref; don't 500 the
    // editor over its option list (conventions:no-silent-loader-catch is about
    // MISREPORTING data — this response says explicitly that loading failed).
    console.error('[dashboard/memory-options] failed to load:', e);
    return json({ options: [], loadFailed: true }, { status: 200 });
  }
  return json({ options, truncated: options.length >= MAX_OPTIONS, loadFailed: false });
};
