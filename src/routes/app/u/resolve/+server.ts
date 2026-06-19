import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { RESOLVE_URN_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';

/**
 * GET /app/u/resolve?urn=<urn> — JSON sibling of the `/app/u/[urn]` redirect
 * route (#262). Returns the `resolveUrn` resolution (`{ kind, id, memoryId,
 * organizationId }`) or `null`, instead of 307-redirecting. The CommandBar
 * (#320) uses it to turn a *parent* URN into a PK before navigating to a
 * create form — e.g. a node URN's memory, or a memory/agent URN's org — since
 * the create pages are PK-scoped (`/app/orgs/[id]/…`, `/app/memories/[id]/…`).
 *
 * Static `resolve/` takes route priority over the sibling `[urn]` dynamic
 * segment; a real URN is always `hrn:<type>:…` so it can never be the literal
 * "resolve". Access control + existence-hiding live entirely in `resolveUrn`
 * (a no-access URN resolves to null exactly like a nonexistent one).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const urn = (url.searchParams.get('urn') ?? '').trim();
  if (!urn) {
    return json({ code: 'INVALID_INPUT', message: 'urn required' }, { status: 400 });
  }
  try {
    const { resolveUrn } = await gqlClient(locals.token).request<{
      resolveUrn: unknown | null;
    }>(RESOLVE_URN_QUERY, { urn });
    return json({ resolution: resolveUrn ?? null });
  } catch (err) {
    if (err instanceof ClientError) {
      const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
      return json(
        { code: ext?.code ?? 'UNKNOWN', message: err.response?.errors?.[0]?.message ?? 'resolve failed' },
        { status: ext?.code === 'PERMISSION_DENIED' ? 403 : 400 },
      );
    }
    return json({ code: 'INTERNAL', message: (err as Error).message }, { status: 500 });
  }
};
