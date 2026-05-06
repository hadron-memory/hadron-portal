import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { UPSERT_NODE_MUTATION } from '$lib/server/queries';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import {
  createNodeStrings,
  createNodeErrorStatus,
  translateCreateNodeError,
} from '$lib/i18n/create-node-strings';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, parent }) => {
  await requireNonConsumer(parent);
  const layout = await parent();
  // The memory layout loader (../+layout.server.ts) already loaded the
  // memory + nodes, with read-access enforcement: if the memory isn't
  // accessible, MEMORY_BY_ID_QUERY returns null and the layout throws
  // before we get here. So if we're rendering, the user can read this
  // memory. Write access is the canonical gate at upsertNode time
  // (see FR-006).
  const parentLoc = url.searchParams.get('parent') ?? '';
  return {
    parentLoc,
    existingLocs: ((layout as unknown as { graphNodes?: MemoryNode[] }).graphNodes ?? [])
      .map((n) => n.loc),
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();

    const name = String(fd.get('name') ?? '').trim();
    const rawLoc = String(fd.get('loc') ?? '').trim();
    const nodeType = String(fd.get('nodeType') ?? 'info').trim();
    const description = String(fd.get('description') ?? '').trim() || null;
    const content = String(fd.get('content') ?? '').trim() || null;

    if (!name) {
      return fail(400, { error: createNodeStrings.errorNameRequired() });
    }

    const loc = cleanLocInput(rawLoc);
    if (!loc) {
      return fail(400, { error: createNodeStrings.errorLocRequired() });
    }

    let newId: string | undefined;
    try {
      const result = await gqlClient(locals.token).request<{
        upsertNode: { id: string };
      }>(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.gid,
          loc,
          name,
          nodeType,
          description,
          content,
          tags: [],
        },
      });
      newId = result.upsertNode.id;
    } catch (e: unknown) {
      return fail(createNodeErrorStatus(e), {
        error: translateCreateNodeError(e),
      });
    }

    if (!newId) {
      return fail(500, { error: createNodeStrings.genericError() });
    }

    redirect(303, `/app/orgs/${params.id}/memories/${params.gid}/nodes/${newId}`);
  },
};
