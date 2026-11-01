import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { FAILED_EXTENSIONS, loadAgentExtensions } from '$lib/server/agent-profile';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { RequestHandler } from './$types';

// portal#1503: the Extended-by section's own re-read. Retry used to call
// invalidateAll(), and a failed __data.json there is turned by SvelteKit into
// the root error page rendered over the whole Agent page — invalidateAll
// resolves instead of rejecting, so the component's catch never ran. This
// endpoint lets the section re-read ONLY its own page: a transport failure is
// a fetch rejection inside the section, so the page and its URL stay put and
// the section's failed-read alert comes back.
//
// Same reader token, same ref resolution and same failure semantics as the
// page loader's call: loadAgentExtensions absorbs its own GraphQL failures
// into `failed: true`, so a 200 here always carries a renderable
// AgentExtensions. Only an unauthenticated caller gets an HTTP error.
export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const headers = { 'cache-control': 'no-store' };
  try {
    // Pass-through like the page loader's `extendedAfter`: the server owns
    // cursor validity, and a bad cursor lands in `failed: true`, not a 500.
    const after = url.searchParams.get('after');
    // Bounded like the loader's optional lists: a wedged upstream must not hold
    // the section in "Retrying…" forever — it settles to the failed read, which
    // re-arms the alert and the Retry control.
    const page = await withTimeout(
      loadAgentExtensions(gqlClient(locals.token), params.id, after),
      OPTIONAL_LIST_TIMEOUT_MS,
      FAILED_EXTENSIONS,
    );
    return json(page, { headers });
  } catch (e) {
    // Unreachable in practice (loadAgentExtensions never rejects); kept so the
    // endpoint's 200-always-carries-a-payload contract cannot regress silently.
    console.error('[agents/extended-by] reload failed:', e);
    return json(FAILED_EXTENSIONS, { headers });
  }
};
