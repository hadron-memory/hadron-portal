// POST /api/assets/reference — attach an existing asset to the graph.
//
// Creates a `nodeType: reference` node at `nodeUrn` whose `data.asset` points at
// the asset, which is the same shape hadron_store_file writes for run-created
// files (hadron-server#888). Per the design decision this stays on the
// CONVENTION rather than a schema-level Asset→Node link, which cor:dmo:060:10
// explicitly reserves — so the pointer is a soft reference and `Node.asset`
// resolves to null once the asset is gone.
//
// The server gates BOTH sides — read on the asset's holding memory, write on the
// memory the reference node lands in — because the two need not be the same.
// Checking only the write side would let a caller copy a file handle out of a
// memory they cannot read.

import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_ASSET_REFERENCE_NODE_MUTATION } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  for (const k of ['assetRef', 'nodeUrn']) {
    if (!body[k]) {
      return json({ code: 'INVALID_INPUT', message: `${k} required` }, { status: 400 });
    }
  }
  try {
    // Forward only the four input fields. Spreading `body` would hand the server
    // whatever else the client sent, and an unknown field is a hard GraphQL
    // validation error on an input object, not a silently ignored one.
    const { createAssetReferenceNode } = await gqlClient(locals.token).request<{
      createAssetReferenceNode: unknown;
    }>(CREATE_ASSET_REFERENCE_NODE_MUTATION, {
      input: {
        assetRef: body.assetRef,
        nodeUrn: body.nodeUrn,
        // Omit rather than send null: the server defaults name to the asset's
        // filename and description to the asset's own, and an explicit null
        // would overwrite those defaults with nothing.
        ...(body.name ? { name: body.name } : {}),
        ...(body.description ? { description: body.description } : {}),
      },
    });
    return json(createAssetReferenceNode);
  } catch (err) {
    return json(...mapAssetError(err, 'createAssetReferenceNode'));
  }
};
