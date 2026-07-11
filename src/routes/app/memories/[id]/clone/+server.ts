import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { CLONE_MEMORY_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

// #520: clone the memory (params.id) into a new memory at `targetUrn`. The
// client owns the full `<org>::<slug>` URN string (composed via the Clone
// dialog's org picker + slug field), the same way /api/nodes/move takes a full
// destination URN — so this endpoint is a thin pass-through to `cloneMemory`.
//
// GraphQL runs server-side only (token in locals), so the memory-detail page's
// Clone dialog POSTs here rather than calling the API from the browser.
export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetUrn = typeof body?.targetUrn === 'string' ? body.targetUrn.trim() : '';
  if (!targetUrn) {
    return json({ error: 'A target memory URN is required.' }, { status: 400 });
  }

  try {
    const res = await gqlClient(locals.token).request<{
      cloneMemory: { id: string; urn: string; name: string };
    }>(CLONE_MEMORY_MUTATION, { ref: params.id, targetUrn });
    return json({ memory: res.cloneMemory });
  } catch (e: unknown) {
    // A malformed/occupied targetUrn, or a system/encrypted source, comes back
    // as BAD_USER_INPUT — surface the server's message as a friendly 400 rather
    // than a generic 500 (matches the /api/nodes/search + move endpoints).
    if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
      return json({ error: extractGqlError(e, 'Invalid clone target.') }, { status: 400 });
    }
    console.error('[memories/clone] failed:', e);
    return json({ error: extractGqlError(e, 'Failed to clone memory') }, { status: 500 });
  }
};
