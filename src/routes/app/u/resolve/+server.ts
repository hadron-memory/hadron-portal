import { extractGqlError } from '$lib/server/gqlError';
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
    // Map only KNOWN GraphQL rejection codes, and only when the ClientError
    // actually carries a GraphQL errors payload — graphql-request also uses
    // ClientError for transport-level failures, which have none. Everything
    // else (internal/unknown codes, payload-less transport failures, plain
    // exceptions) is a 500, so callers can tell an outage apart from a
    // non-resolving URN — the CommandBar's resolveUrn throws on 5xx and
    // surfaces an inline error instead of falling back to a guessed candidate
    // (see hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only, #614/#567).
    if (err instanceof ClientError && err.response?.errors?.length) {
      const first = err.response.errors[0];
      const code = (first.extensions as { code?: string } | undefined)?.code;
      const body = { code: code ?? 'UNKNOWN', message: first.message ?? 'resolve failed' };
      if (code === 'BAD_USER_INPUT' || code === 'GRAPHQL_VALIDATION_FAILED') {
        return json(body, { status: 400 });
      }
      if (code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED') {
        return json(body, { status: 401 });
      }
      // No-access collapses into the same status as not-found (existence-hiding).
      if (
        code === 'NOT_FOUND' ||
        code === 'NODE_NOT_FOUND' ||
        code === 'FORBIDDEN' ||
        code === 'PERMISSION_DENIED'
      ) {
        return json(body, { status: 404 });
      }
    }
    return json(
      { code: 'INTERNAL', message: extractGqlError(err, 'resolve failed') },
      { status: 500 },
    );
  }
};
