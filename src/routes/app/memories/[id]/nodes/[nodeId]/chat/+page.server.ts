import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, UPSERT_NODE_MUTATION } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);
  if (!data.nodeById) throw new Error(`Node not found: ${params.nodeId}`);
  const node = data.nodeById;

  if (node.memoryId !== params.id) {
    redirect(303, `/app/memories/${node.memoryId}/nodes/${params.nodeId}/chat`);
  }

  // Detect team-chat tag
  if (!node.tags.includes('team-chat')) {
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  }

  // Find the `messages` child node under the chat node
  const messagesNode = (parentData.graphNodes ?? []).find(
    (n) => n.loc === `${node.loc}:messages`
  );

  // Load children as messages — get direct children of the messages node.
  // Messages are stored under a dedicated `messages` parent for organization
  // (allows other content like attachments under the chat node).
  let children = messagesNode
    ? (parentData.graphNodes ?? [])
        .filter((n) => {
          if (n.loc === messagesNode.loc) return false;
          if (!n.loc.startsWith(messagesNode.loc + ':')) return false;
          const rest = n.loc.slice(messagesNode.loc.length + 1);
          return !rest.includes(':');
        })
        .sort((a, b) => {
          const timeA = new Date(a.createdAt).getTime();
          const timeB = new Date(b.createdAt).getTime();
          return timeA - timeB;
        })
    : [];

  // Compute fullUrn like the node detail page does
  let fullUrn = node.loc;
  if (parentData.graph?.urn && node.loc.startsWith(parentData.graph.urn + ':')) {
    let loc = node.loc.slice(parentData.graph.urn.length + 1);
    fullUrn = parentData.graph.urn && loc ? `${parentData.graph.urn}::${loc}` : node.loc;
  } else if (parentData.graph?.urn) {
    fullUrn = `${parentData.graph.urn}::${node.loc}`;
  }

  return {
    node,
    fullUrn,
    messages: children.map((msg) => ({
      id: msg.id,
      name: msg.name || 'Unknown',
      content: msg.content || '',
      createdAt: msg.createdAt,
    })),
  };
};

export const actions: Actions = {
  sendMessage: async ({ request, params, locals }) => {
    const formData = await request.formData();
    const content = formData.get('content')?.toString().trim();

    if (!content) return fail(400, { error: 'Message cannot be empty' });

    try {
      // Fetch the parent node to get its loc
      const { nodeById } = await gqlClient(locals.token).request<{ nodeById: MemoryNode | null }>(
        NODE_BY_ID_QUERY, { id: params.nodeId },
      );
      if (!nodeById) return fail(404, { error: 'Chat node not found' });

      // Get current user from JWT (available in locals)
      const user = locals.user;
      if (!user) return fail(401, { error: 'Not authenticated' });

      // Ensure the messages parent node exists
      const messagesLoc = `${nodeById.loc}:messages`;
      await gqlClient(locals.token).request<{
        upsertNode: MemoryNode;
      }>(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.id,
          loc: messagesLoc,
          name: 'messages',
          nodeType: 'info',
        },
      });

      // Create a new message node under the messages parent
      // Use ISO timestamp for consistent, sortable message IDs
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, -1); // e.g., 20260621T223100Z
      const senderInitial = user.email?.split('@')[0] || 'anon';
      const messageId = `${timestamp}-${senderInitial}`;
      const messageLoc = `${messagesLoc}:${messageId}`;

      const { upsertNode } = await gqlClient(locals.token).request<{
        upsertNode: MemoryNode;
      }>(UPSERT_NODE_MUTATION, {
        input: {
          memoryId: params.id,
          loc: messageLoc,
          name: user.email || 'Anonymous',
          content,
          nodeType: 'info',
        },
      });

      return { success: true, message: upsertNode };
    } catch (error) {
      console.error('Failed to send message:', error);
      return fail(500, { error: 'Failed to send message' });
    }
  },
};
