import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { AI_CONFIG_PRINCIPAL_QUERY } from '$lib/server/queries';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
import type { RequestHandler } from './$types';

// #1986 (Griffen F3): the cookie-principal read, split from the owner-list
// route so it cannot share a code path with the config reads. It answers one
// question, "who does the server think this cookie is?", and returns ONLY
// {principalType, userId, appId}: no config, no key, no preview. It selects no
// field of an AiServiceConfig, so it is not a second route to the key, which
// stays masked everywhere but its one gated decrypt path (hrn:node:hadronmemory.com:specs:cor:dmo:050:10).
// Reads the existing server identity with THIS request's cookie. No JWT decode
// fallback, auth mutation, draft payload or new write precondition.
export const GET: RequestHandler = async ({ locals, request }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token) return json({ principal: null }, { headers });
  try {
    const data = await gqlClient(locals.token, request.signal).request<{
      authContext: { principalType: string; user: { id: string } | null; appId: string | null } | null;
    }>(AI_CONFIG_PRINCIPAL_QUERY);
    if (data.authContext === null) return json({ principal: null }, { headers });
    const context = data.authContext;
    if (!context || !['USER', 'APP'].includes(context.principalType)) throw new Error('Identity unavailable');
    return json({ principal: { principalType: context.principalType, userId: context.user?.id ?? null, appId: context.appId } }, { headers });
  } catch {
    return json({ error: aiConfigStrings.principalUnavailable() }, { status: 503, headers });
  }
};
