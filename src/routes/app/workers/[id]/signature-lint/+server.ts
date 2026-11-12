import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { WORKER_SIGNATURE_LINT } from '$lib/server/worker-signature-lint';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { signatureLintPage } from '$lib/worker-signature-lint';
import type { RequestHandler } from './$types';

// Same viewer and server-owned masking as the templates. No text/targets or extra lookup.
export const GET: RequestHandler = async ({ locals, params }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token) return json({ page: null }, { status: 401, headers });
  try {
    const result = await withTimeout(gqlClient(locals.token).request<{ worker: { signatureLint: unknown } | null }>(WORKER_SIGNATURE_LINT, { ref: params.id }), OPTIONAL_LIST_TIMEOUT_MS, null);
    return json({ workerId: params.id, page: signatureLintPage(result?.worker?.signatureLint) }, { headers });
  } catch {
    // No response diagnostics: denied, old schema and faults get the same neutral UI.
    return json({ workerId: params.id, page: null }, { status: 502, headers });
  }
};
