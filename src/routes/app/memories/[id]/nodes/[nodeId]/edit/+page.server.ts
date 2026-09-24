import { error, fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { loadSkillCheck } from '$lib/server/skill-check';
// #868: the write goes through the door chooser; naming a mutation document
// here directly is what `scripts/check-node-write-doors.mjs` fails.
import { assertNodeUpdateDoor, nodeUpdateDocument, NoNodeDoorError } from '$lib/server/nodeKindDoor';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { editNodeSchema } from './schema';

type EditNodeForm = Infer<typeof editNodeSchema, 'zod4'>;

const editNodeFormAdapter = zod4(editNodeSchema);

function formDefaults(node: MemoryNode): EditNodeForm {
  return {
    isRunnable: node.isRunnable ?? false,
    objectType: node.objectType ?? '',
    propertiesJson: node.properties != null ? JSON.stringify(node.properties, null, 2) : '',
  };
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const data = await client.request<{ node: MemoryNode | null }>(
    NODE_BY_ID_QUERY, { ref: params.nodeId },
  );
  // #790: the same bare-throw-as-500 the detail page had, one route over. Found
  // by sweeping `throw new Error(` across src/routes rather than by anyone
  // hitting it — the two were written independently, which is what makes this a
  // pattern rather than a typo. A node that is not there is a 404; a 500 tells
  // the user the portal is broken and hands a probe the existence/access
  // distinction that returning null for both is meant to hide.
  if (!data.node) throw error(404, 'Node not found');
  // #237: same URL-acceptance guard as the detail page. Without it, an
  // edit URL with a mismatched (gid, nodeId) would let the user save
  // changes into the foreign node while believing they edit the current
  // memory's row. Redirect to the correct edit URL so the destination
  // memory is consistent with the node's actual ownership.
  if (data.node.memoryId !== params.id) {
    redirect(303, `/app/memories/${data.node.memoryId}/nodes/${params.nodeId}/edit`);
  }
  const form = await superValidate<EditNodeForm>(
    formDefaults(data.node),
    editNodeFormAdapter,
    { errors: false },
  );
  return {
    node: data.node,
    form,
    runnableBlockedBy: runnableBlockedBy(data.node),
    noWriteDoor: noWriteDoor(data.node),
    // #882: the server's lint verdict on the STORED export, per declared host.
    // Never throws — a check that could not run is reported, not hidden.
    skillCheck: await loadSkillCheck(client, data.node),
  };
};

/**
 * @copilot on #887: a node that ALREADY carries two governed kinds (a runnable
 * `review` or `spec`) has no single write door, so EVERY save from this page is
 * refused — whatever the user changes. Asked of the same chooser the action
 * uses, with an input that changes neither signal, and returned as the
 * chooser's own message so the page can say why before offering a Save that
 * can only fail.
 */
function noWriteDoor(node: MemoryNode): string | null {
  try {
    nodeUpdateDocument(node, {});
    return null;
  } catch (e) {
    if (!(e instanceof NoNodeDoorError)) throw e;
    return e.message;
  }
}

/**
 * #878 / @copilot on #887: can this page make the node runnable?
 *
 * The skill-export checkbox, and its "Mark this node runnable" action, submit
 * `isRunnable: true`. On a node that already carries another governed kind (a
 * `review` or `spec` role) the result matches two kinds, and the door chooser
 * refuses it: there is no single write path. Asked of the SAME chooser the
 * action uses, so the page cannot offer a fix the save would then reject.
 *
 * Returns the other kind(s) blocking it, or null when making it runnable works.
 */
function runnableBlockedBy(node: MemoryNode): string | null {
  try {
    nodeUpdateDocument(node, { isRunnable: true });
    return null;
  } catch (e) {
    if (!(e instanceof NoNodeDoorError)) throw e;
    return e.kinds.filter((k) => k !== 'task').join(' and ') || null;
  }
}

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await superValidate<EditNodeForm>(
      await request.formData(),
      editNodeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);

    // Load current node to get its loc
    const { node: currentNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    );
    if (!currentNode) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });

    const objectType = form.data.objectType || null;
    const propertiesTrimmed = form.data.propertiesJson.trim();
    const properties = propertiesTrimmed
      ? (JSON.parse(propertiesTrimmed) as Record<string, unknown>)
      : null;

    // #878: ONLY the fields this page edits. `UpdateNodeInput` treats an
    // omitted field as "preserve", so name, description, content, abstract,
    // tags, seq and edges — each edited on its own tab of the node page — are
    // left exactly as stored.
    //
    // `isRunnable` is sent only as `true`. The page can turn it ON (the skill
    // export requires a runnable node) but has no control that turns it off;
    // sending the loaded `false` back would let a stale page, or a POST that
    // simply omits the checkbox, un-set Runnable on a task node.
    const input = {
      memoryId: currentNode.memoryId,
      loc: currentNode.loc,
      ...(form.data.isRunnable ? { isRunnable: true } : {}),
      objectType,
      properties,
    };
    try {
      assertNodeUpdateDoor(currentNode, input);
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to save') }, { status: 500 });
    }

    try {
      await client.request(nodeUpdateDocument(currentNode, input), { input });
    } catch (e: unknown) {
      const text = extractGqlError(e, 'Failed to save');
      // #588: a memory-schema violation (undeclared collection, missing
      // required field, wrong type, unknown key under strict) — surface the
      // server's verdict verbatim on the properties field.
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
        return setError(form, 'propertiesJson', text, { status: 400 });
      }
      return message(form, { type: 'error', text }, { status: 500 });
    }

    // Redirect to the actual memory's detail URL, not the URL's gid.
    redirect(303, `/app/memories/${currentNode.memoryId}/nodes/${params.nodeId}`);
  },
};
