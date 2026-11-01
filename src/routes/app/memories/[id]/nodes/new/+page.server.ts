import { fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { CREATE_NODE_MUTATION } from '$lib/server/queries';
import { includeRefusalOf, includeRefusalText } from '$lib/server/include-refusal';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import {
  createNodeStrings,
  createNodeErrorCode,
  createNodeErrorStatus,
  translateCreateNodeError,
} from '$lib/i18n/create-node-strings';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createNodeSchema } from './schema';

type CreateNodeForm = Infer<typeof createNodeSchema, 'zod4'>;

const createNodeFormAdapter = zod4(createNodeSchema);

export const load: PageServerLoad = async ({ url, parent }) => {
  // Single parent() call: reuse the layout data for the consumer-mode
  // gate AND for existingLocs. requireNonConsumer would call parent()
  // internally, duplicating the layout's GraphQL fan-out (org/memory/
  // nodes/usage) — caught in PR review.
  const layout = await parent() as unknown as {
    isConsumerMode?: boolean;
    activeOrgId?: string | null;
    graph?: { organizationId?: string | null };
    graphNodes?: MemoryNode[];
  };
  // #627: mirror requireNonConsumer's exemption — a consumer may author nodes in
  // a memory they own directly (org-less, organizationId == null). Only bounce
  // them from org-scoped memories; write access is enforced at createNode.
  const ownsOrglessMemory = !!layout.graph && layout.graph.organizationId == null;
  if (layout.isConsumerMode && !ownsOrglessMemory) {
    redirect(303, layout.activeOrgId ? `/app/orgs/${layout.activeOrgId}/` : '/app/orgs/');
  }

  // The memory layout loader (../+layout.server.ts) already loaded the
  // memory + nodes, with read-access enforcement: if the memory isn't
  // accessible, MEMORY_BY_ID_QUERY returns null and the layout throws
  // before we get here. So if we're rendering, the user can read this
  // memory. Write access is the canonical gate at createNode time
  // (see FR-006).
  const parentLoc = cleanLocInput(url.searchParams.get('parent') ?? '');

  // #320: the header command bar (Create mode) deep-links a full node loc here
  // via `?loc=<loc>` (derived from the node URN's last `::` segment). Normalize
  // it through the same helper the submit path uses.
  const prefillLoc = cleanLocInput(url.searchParams.get('loc') ?? '');

  // portal#1524: the memory layout no longer carries the node list, so there
  // is nothing to suffix a default loc against. An empty list is "not loaded",
  // not "nothing exists": a duplicate loc is refused by the server at submit
  // and shown as it always was.
  // The key is still read so a restored list (portal#1438) suffixes again.
  const existingLocs = (layout.graphNodes ?? [])
    .map((n) => cleanLocInput(n.loc))
    .filter((s) => s !== '');

  const form = await superValidate<CreateNodeForm>(
    { loc: prefillLoc },
    createNodeFormAdapter,
    { errors: false },
  );

  return { parentLoc, prefillLoc, existingLocs, form };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await superValidate<CreateNodeForm>(
      await request.formData(),
      createNodeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const loc = cleanLocInput(form.data.loc);
    const description = form.data.description || null;
    const abstract = form.data.abstract || null;
    const content = form.data.content || null;
    const tags = [...new Set(form.data.tags.split(',').map((tag) => tag.trim()).filter(Boolean))];
    // #588: empty → omit (ordinary node / no properties). The zod schema
    // already proved propertiesJson parses to an object; re-parse only to
    // produce the typed payload. The server validates both against the
    // memory schema (BAD_USER_INPUT on a violation).
    const objectType = form.data.objectType || undefined;
    const propertiesTrimmed = form.data.propertiesJson.trim();
    const properties = propertiesTrimmed
      ? (JSON.parse(propertiesTrimmed) as Record<string, unknown>)
      : undefined;

    let newId: string | undefined;
    try {
      // hadron-server#460: createNode IS create-only — it rejects with
      // NodeLocConflictError if (loc, memoryId) already exists, rather
      // than silently updating the existing node (the old NodeInput
      // createOnly flag is gone; the semantics are baked in). The portal's
      // typed-error mapper recognizes the code and shows friendly copy.
      const result = await gqlClient(locals.token).request<{
        createNode: { id: string };
      }>(CREATE_NODE_MUTATION, {
        input: {
          memoryId: params.id,
          loc,
          name: form.data.name,
          nodeType: form.data.nodeType,
          objectType,
          description,
          abstract,
          content,
          properties,
          tags,
        },
      });
      newId = result.createNode.id;
    } catch (e: unknown) {
      // portal#1142 S2b: an include refusal created nothing; the form keeps
      // what was typed, with the server's words, the tag and the next step.
      const include = includeRefusalOf(e);
      if (include) return message(form, { type: 'error', text: includeRefusalText(include, 'create') }, { status: 400 });
      const error = translateCreateNodeError(e);
      const status = createNodeErrorStatus(e);
      const code = createNodeErrorCode(e);
      if (code === 'NodeLocConflictError' || code === 'InvalidLocError') {
        return setError(form, 'loc', error, { status });
      }
      // #588: a memory-schema violation (undeclared collection, missing
      // required field, wrong type, unknown key under strict) — surface the
      // server's verdict verbatim on the properties field.
      if (code === 'BAD_USER_INPUT') {
        return setError(form, 'propertiesJson', error, { status: 400 });
      }
      return message(form, { type: 'error', text: error }, { status });
    }

    if (!newId) {
      return message(form, { type: 'error', text: createNodeStrings.genericError() }, { status: 500 });
    }

    redirect(303, `/app/memories/${params.id}/nodes/${newId}`);
  },
};
