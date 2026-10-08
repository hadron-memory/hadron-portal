/**
 * #1031 — the Properties tab's storage form: object type, typed properties and
 * the skill export.
 *
 * This was the `/nodes/[nodeId]/edit` page (#588, #864, #878) until #1031 moved
 * its form onto the Properties tab. The load-side helpers and the action body
 * moved here unchanged except for two things the new home requires: the form
 * carries a `_kind` and an explicit id, because the node page has a dozen
 * other forms sharing its action data
 * (`hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids`);
 * and a successful save RETURNS rather than redirecting, because the reader is
 * already on the page the redirect pointed at.
 */
import { fail, type RequestEvent } from '@sveltejs/kit';
import type { Infer, SuperValidated } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
// #868: the write goes through the door chooser; naming a mutation document
// here directly is what `scripts/check-node-write-doors.mjs` fails.
import { assertNodeUpdateDoor, nodeUpdateDocument, NoNodeDoorError } from '$lib/server/nodeKindDoor';
import type { MemoryNode } from '$lib/types';
import { nodeStorageSchema } from './storage-schema';

export type NodeStorageForm = Infer<typeof nodeStorageSchema, 'zod4'>;

/** The storage form's superforms id; see the module note. */
export const NODE_STORAGE_FORM_ID = 'node-storage';

const nodeStorageFormAdapter = zod4(nodeStorageSchema);

function formDefaults(node: MemoryNode): NodeStorageForm {
  return {
    _kind: 'updateStorage',
    isRunnable: node.isRunnable ?? false,
    objectType: node.objectType ?? '',
    propertiesJson: node.properties != null ? JSON.stringify(node.properties, null, 2) : '',
  };
}

/** The loader's seed for the storage form, from the stored node. */
export function nodeStorageSeed(
  node: MemoryNode,
): Promise<SuperValidated<NodeStorageForm, App.Superforms.Message, NodeStorageForm>> {
  return superValidate<NodeStorageForm>(formDefaults(node), nodeStorageFormAdapter, {
    errors: false,
    id: NODE_STORAGE_FORM_ID,
  });
}

/**
 * @copilot on #887: a node that ALREADY carries two governed kinds (a runnable
 * `review` or `spec`) has no single write door, so EVERY save from this form is
 * refused — whatever the user changes. Asked of the same chooser the action
 * uses, with an input that changes neither signal, and returned as the
 * chooser's own message so the page can say why before offering a Save that
 * can only fail.
 */
export function noWriteDoor(node: MemoryNode): string | null {
  try {
    nodeUpdateDocument(node, {});
    return null;
  } catch (e) {
    if (!(e instanceof NoNodeDoorError)) throw e;
    return e.message;
  }
}

/**
 * #878 / @copilot on #887: can this form make the node runnable?
 *
 * The skill-export checkbox, and its "Mark this node runnable" action, submit
 * `isRunnable: true`. On a node that already carries another governed kind (a
 * `review` or `spec` role) the result matches two kinds, and the door chooser
 * refuses it: there is no single write path. Asked of the SAME chooser the
 * action uses, so the page cannot offer a fix the save would then reject.
 *
 * Returns the other kind(s) blocking it, or null when making it runnable works.
 */
export function runnableBlockedBy(node: MemoryNode): string | null {
  try {
    nodeUpdateDocument(node, { isRunnable: true });
    return null;
  } catch (e) {
    if (!(e instanceof NoNodeDoorError)) throw e;
    return e.kinds.filter((k) => k !== 'task').join(' and ') || null;
  }
}

export async function updateStorage({ request, params, locals }: RequestEvent<{ id: string; nodeId: string }>) {
  const form = await superValidate<NodeStorageForm>(
    await request.formData(),
    nodeStorageFormAdapter,
    { id: NODE_STORAGE_FORM_ID },
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

  // #878: ONLY the fields this form edits. `UpdateNodeInput` treats an
  // omitted field as "preserve", so name, description, content, abstract,
  // tags, seq and edges — each edited on its own tab of the node page — are
  // left exactly as stored.
  //
  // `isRunnable` is sent only as `true`. The form can turn it ON (the skill
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

  return message(form, { type: 'success', text: 'Saved.' });
}
