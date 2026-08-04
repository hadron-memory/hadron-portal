import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, CREATE_NODE_MUTATION, NODES_BY_LOC_PREFIX_QUERY } from '$lib/server/queries';
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

  // Detect team-chat tag
  if (!node.tags.includes('team-chat')) {
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  }

  // Load children as messages. Messages are stored at: {chat.loc}:messages:{id}
  // This allows other content (attachments, etc) under the chat without collision.
  const messagesPrefix = `${node.loc}:messages:`;

  // #447: the memory layout's graphNodes are now the slim projection (no
  // content/data/createdAt), so fetch the message children directly with full
  // fields via the loc-prefix query. Non-fatal on error — an empty thread beats
  // crashing the chat page.
  const messagesData = await gqlClient(locals.token)
    .request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(NODES_BY_LOC_PREFIX_QUERY, {
      memoryId: params.id,
      locPrefix: messagesPrefix,
      limit: 2000,
    })
    .catch((err) => {
      console.error('[chat-page] messages query failed:', err);
      return { findNodes: { hits: [] as Array<{ node: MemoryNode }> } };
    });

  let children = messagesData.findNodes.hits
    .map((h) => h.node)
    .filter((n: MemoryNode) => {
      if (!n?.loc?.startsWith(messagesPrefix)) return false;
      // Only include direct message children (no further nesting)
      const rest = n.loc.slice(messagesPrefix.length);
      return !rest.includes(':');
    })
    .sort((a: MemoryNode, b: MemoryNode) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeA - timeB;
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
    messages: children.map((msg: MemoryNode) => {
      const msgData = msg.data as Record<string, unknown> | null;
      return {
        id: msg.id,
        name: msg.name || 'Unknown',
        author: (msgData?.author as string) || msg.name || 'Unknown',
        content: msg.content || (msgData?.body as string) || '',
        createdAt: msg.createdAt,
        nodeData: { loc: msg.loc },
      };
    }),
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

      // Get current user from JWT (available in locals)
      const user = locals.user;
      if (!user) return message(form, { type: 'error', text: 'Not authenticated' }, { status: 401 });

      // Create a new message node at: {chat.loc}:messages:{timestamp}-{sender}
      // Use ISO timestamp for consistent, sortable message IDs
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, -1); // e.g., 2026-06-21T223100Z
      const username =
        (user as any).handle ||
        (user as any).githubUsername ||
        (user as any).name ||
        user.email?.split('@')[0] ||
        'anon';
      const messageId = `${timestamp}-${username}`;
      const messageLoc = `${node.loc}:messages:${messageId}`;

      // Message locs embed a timestamp + username, so each send targets a
      // fresh loc — pure create (a same-second double submit surfaces as a
      // loud conflict error rather than silently merging).
      const { createNode } = await gqlClient(locals.token).request<{
        createNode: MemoryNode;
      }>(CREATE_NODE_MUTATION, {
        input: {
          memoryId: params.id,
          loc: messageLoc,
          name: username,
          nodeType: 'message',
          data: { body: form.data.content, author: username },
        },
      });

      return {
        sent: true,
        messageNode: createNode,
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
