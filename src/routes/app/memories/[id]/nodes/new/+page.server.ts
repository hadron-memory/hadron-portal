import { fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { CREATE_NODE_MUTATION, MEMORY_ROLE_RULES_QUERY } from '$lib/server/queries';
import { nodeRoleRefusalText } from '$lib/node-role-refusal';
import { roleUpdate } from '$lib/node-role';
import type { RoleRuleRow } from '$lib/node-role-rules';
import { readChildrenPage } from '$lib/server/node-children';
import { includeRefusalOf, includeRefusalText } from '$lib/server/include-refusal';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import {
  createNodeStrings,
  createNodeErrorCode,
  createNodeErrorStatus,
  isBadLocError,
  translateCreateNodeError,
} from '$lib/i18n/create-node-strings';
import type { Actions, PageServerLoad } from './$types';
import { createNodeSchema } from './schema';

type CreateNodeForm = Infer<typeof createNodeSchema, 'zod4'>;

const createNodeFormAdapter = zod4(createNodeSchema);

export const load: PageServerLoad = async ({ url, parent, params, locals }) => {
  // Single parent() call: reuse the layout data for the consumer-mode
  // gate. requireNonConsumer would call parent() internally, duplicating the
  // layout's GraphQL fan-out (org/memory/nodes/usage) — caught in PR review.
  const layout = await parent() as unknown as {
    isConsumerMode?: boolean;
    activeOrgId?: string | null;
    graph?: { organizationId?: string | null };
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

  // portal#1656: the siblings the default loc is suffixed against are the
  // direct children of ?parent (the top level when there is none), one bounded
  // page read with `childrenOf`. The layout's node list (portal#1524) is gone.
  // A page that says more exist, or a failed read, makes the list PARTIAL: the
  // page then says the suggestion may collide, rather than treating what it
  // has as complete. The server's duplicate-loc refusal at submit stays the
  // final word, shown as it always was.
  let existingLocs: string[] = [];
  let siblingsPartial = false;
  try {
    const page = await readChildrenPage(gqlClient(locals.token), params.id, parentLoc, 0);
    existingLocs = page.children.map((n) => cleanLocInput(n.loc)).filter((s) => s !== '');
    siblingsPartial = page.hasMore;
  } catch (err) {
    console.warn('[new-node] sibling read failed:', err);
    siblingsPartial = true;
  }

  // #1670: a manager's declared roles. `Memory.config` is null for anyone who
  // does not manage the memory (and then the page keeps its plain suggestions);
  // a failed read is the same, never an error page. Read here, not in the layout.
  let roleRules: RoleRuleRow[] | null = null;
  try {
    const res = await gqlClient(locals.token).request<{
      memory: { config: { rules: RoleRuleRow[] } | null } | null;
    }>(MEMORY_ROLE_RULES_QUERY, { ref: params.id });
    roleRules = res?.memory?.config?.rules ?? null;
  } catch {
    roleRules = null;
  }

  const form = await superValidate<CreateNodeForm>(
    { loc: prefillLoc },
    createNodeFormAdapter,
    { errors: false },
  );

  return { parentLoc, prefillLoc, existingLocs, siblingsPartial, roleRules, form };
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

    // #1670: trimmed only, omitted when empty (a create has no seed to clear).
    const role = roleUpdate(form.data.role, '');

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
          ...(role !== undefined && role !== null ? { role } : {}),
        },
      });
      newId = result.createNode.id;
    } catch (e: unknown) {
      // portal#1142 S2b: an include refusal created nothing; the form keeps
      // what was typed, with the server's words, the tag and the next step.
      const include = includeRefusalOf(e);
      if (include) return message(form, { type: 'error', text: includeRefusalText(include, 'create') }, { status: 400 });
      // #1670: a role refusal changed nothing; say why, keep what was typed.
      const roleRefusal = nodeRoleRefusalText(e);
      if (roleRefusal) return message(form, { type: 'error', text: roleRefusal }, { status: 403 });
      const error = translateCreateNodeError(e);
      const status = createNodeErrorStatus(e);
      const code = createNodeErrorCode(e);
      // portal#2323: a bad loc is BAD_USER_INPUT with a `reason` (or the old
      // InvalidLocError); decided BEFORE the #588 branch below, which takes
      // every other BAD_USER_INPUT.
      if (code === 'NodeLocConflictError' || isBadLocError(e)) {
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
