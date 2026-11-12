import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { SET_ASSET_PUBLIC_LINK_MUTATION } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
import type { RequestHandler } from './$types';

/**
 * #1131: switch one asset's public link. A thin authenticated proxy — the server
 * decides who may switch (hrn:node:hadronmemory.com:specs:cor:acl:010:01) and the portal never recomputes the
 * class-manager matrix, so a forced post from a non-manager reaches the server
 * and comes back as its typed refusal, mapped by `mapAssetError`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const { assetId, enabled } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof assetId !== 'string' || !assetId) {
    return json({ code: 'INVALID_INPUT', message: 'assetId required' }, { status: 400 });
  }
  // Strictly a boolean: a string "false" is truthy to the next reader, and this
  // is the field that publishes a file to anyone holding its URL.
  if (typeof enabled !== 'boolean') {
    return json({ code: 'INVALID_INPUT', message: 'enabled must be true or false' }, { status: 400 });
  }
  try {
    const { setAssetPublicLink } = await gqlClient(locals.token).request<{
      setAssetPublicLink: unknown;
    }>(SET_ASSET_PUBLIC_LINK_MUTATION, { assetRef: assetId, enabled });
    // The caller refreshes from this answer, so a malformed one is a fault, not a
    // success the page would then display.
    const a = setAssetPublicLink as Record<string, unknown> | null;
    if (!a || a.id !== assetId || typeof a.publicLinkEnabled !== 'boolean') {
      throw new Error('setAssetPublicLink returned an unexpected shape');
    }
    return json(a);
  } catch (err) {
    return json(...mapAssetError(err, 'setAssetPublicLink'));
  }
};
