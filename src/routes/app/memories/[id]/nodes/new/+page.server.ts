import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
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
  // Single parent() call: reuse the layout data for the consumer-mode
  // gate AND for existingLocs. requireNonConsumer would call parent()
  // internally, duplicating the layout's GraphQL fan-out (org/memory/
  // nodes/usage) — caught in PR review.
  const layout = await parent() as unknown as {
    isConsumerMode?: boolean;
    activeOrgId?: string | null;
    graphNodes?: MemoryNode[];
  };
  if (layout.isConsumerMode) {
    redirect(303, layout.activeOrgId ? `/app/orgs/${layout.activeOrgId}/` : '/app/orgs/');
  }

  // The memory layout loader (../+layout.server.ts) already loaded the
  // memory + nodes, with read-access enforcement: if the memory isn't
  // accessible, MEMORY_BY_ID_QUERY returns null and the layout throws
  // before we get here. So if we're rendering, the user can read this
  // memory. Write access is the canonical gate at upsertNode time
  // (see FR-006).
  const parentLoc = cleanLocInput(url.searchParams.get('parent') ?? '');

  // Normalize existingLocs through the same helper that runs at submit
  // time, so collision suffixing in deriveDefaultLoc is computed against
  // the canonical loc shape that will actually be submitted (legacy
  // memory-prefixed locs in storage map to the same bare form here).
  const existingLocs = (layout.graphNodes ?? [])
    .map((n) => cleanLocInput(n.loc))
    .filter((s) => s !== '');

  return { parentLoc, existingLocs };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();

    const name = String(fd.get('name') ?? '').trim();
    const rawLoc = String(fd.get('loc') ?? '').trim();
    const nodeType = String(fd.get('nodeType') ?? 'info').trim();
    const description = String(fd.get('description') ?? '').trim() || null;
    const abstract = String(fd.get('abstract') ?? '').trim() || null;
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
          memoryId: params.id,
          loc,
          name,
          nodeType,
          description,
          abstract,
          content,
          tags: [],
          // Spec 011 + hadron-server#104: this is a CREATE form, not an
          // upsert. createOnly tells the server to reject with
          // NodeLocConflictError if (loc, memoryId) already exists,
          // rather than silently updating the existing node. The portal's
          // typed-error mapper recognizes the code and shows friendly copy.
          createOnly: true,
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

    redirect(303, `/app/memories/${params.id}/nodes/${newId}`);
  },
};
