import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { chatAuthorName, chatPostTarget, isChatNode, loadChatMessages, postChatMessage } from '$lib/server/team-chat';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { sendChatMessageSchema } from './schema';

const sendChatMessageFormAdapter = zod4(sendChatMessageSchema);

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  let parentData: any = {};
  let data: any = {};

  try {
    [parentData, data] = await Promise.all([
      parent().catch((err) => {
        console.error('[chat-page] parent() failed:', err);
        // Return minimal safe structure if parent fails
        return { graphNodes: [], graph: null, org: null, treeEntries: [], graphViewData: null, usageByNode: {} };
      }),
      gqlClient(locals.token).request<{ node: MemoryNode | null }>(
        NODE_BY_ID_QUERY, { ref: params.nodeId },
      ).catch((err) => {
        console.error('[chat-page] NODE_BY_ID_QUERY failed:', err);
        // Rethrow node query errors as they're critical
        throw err;
      }),
    ]);
  } catch (err) {
    console.error('[chat-page] load failed:', err);
    throw err;
  }

  try {
    await requireNonConsumer(async () => parentData);
  } catch (err) {
    console.error('[chat-page] requireNonConsumer failed:', err);
    throw err;
  }

  if (!data.node) {
    throw error(404, `Chat node not found: ${params.nodeId}`);
  }

  const node = data.node;

  if (node.memoryId !== params.id) {
    redirect(303, `/app/memories/${node.memoryId}/nodes/${params.nodeId}/chat`);
  }

  // Chat nodes only (`nodeType: 'chat'`, or the legacy `team-chat` tag).
  if (!isChatNode(node)) {
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  }

  // Non-fatal on error — an empty thread beats crashing the chat page.
  const messages = await loadChatMessages(gqlClient(locals.token), params.id, node.loc).catch((err) => {
    console.error('[chat-page] messages query failed:', err);
    return [];
  });

  // Compute fullUrn like the node detail page does
  let fullUrn = node.loc;
  if (parentData?.graph?.urn && node.loc.startsWith(parentData.graph.urn + ':')) {
    let loc = node.loc.slice(parentData.graph.urn.length + 1);
    fullUrn = parentData.graph.urn && loc ? `${parentData.graph.urn}::${loc}` : node.loc;
  } else if (parentData?.graph?.urn) {
    fullUrn = `${parentData.graph.urn}::${node.loc}`;
  }

  return {
    node,
    fullUrn,
    messages,
    // Same predicate the action re-derives from the node, so the composer is
    // shown exactly when a post would be accepted.
    canPost: chatPostTarget(node).kind !== 'none',
    form: await superValidate({}, sendChatMessageFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  sendMessage: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), sendChatMessageFormAdapter);
    if (!form.valid) return fail(400, { form });

    try {
      // Fetch the parent node to get its loc
      const { node } = await gqlClient(locals.token).request<{ node: MemoryNode | null }>(
        NODE_BY_ID_QUERY, { ref: params.nodeId },
      );
      if (!node) {
        return message(form, { type: 'error', text: 'Chat node not found' }, { status: 404 });
      }
      // Form actions run BEFORE `load`, so the load's redirect can't be the
      // gate: a direct POST to an ordinary node's ?/sendMessage would otherwise
      // reach postChatMessage with an unrelated node.
      if (!isChatNode(node)) {
        return message(form, { type: 'error', text: 'This node is not a chat.' }, { status: 400 });
      }

      // Get current user from JWT (available in locals)
      const user = locals.user;
      if (!user) return message(form, { type: 'error', text: 'Not authenticated' }, { status: 401 });

      // Which thread this actually writes to is a property of the node — see
      // chatPostTarget. `none` would mean posting into a different chat.
      const target = chatPostTarget(node);
      if (target.kind === 'none') {
        return message(
          form,
          { type: 'error', text: "This chat isn't attached to an app, so there's nowhere to post from here." },
          { status: 400 },
        );
      }
      const posted = await postChatMessage(gqlClient(locals.token), {
        target,
        // #237: memoryId from the node, not the URL, which may be stale.
        memoryId: node.memoryId,
        chatLoc: node.loc,
        author: chatAuthorName(user),
        content: form.data.content,
      });

      return {
        sent: true,
        messageNode: posted,
        ...message(form, { type: 'success', text: 'Message sent.' }),
      };
    } catch (error) {
      console.error('Failed to send message:', error);
      return message(
        form,
        { type: 'error', text: extractGqlError(error, 'Failed to send message') },
        { status: 500 },
      );
    }
  },
};
