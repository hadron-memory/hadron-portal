import { error, fail, redirect } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { chatAuthorName, chatPostTarget, chatSortKey, isChatNode, loadChatMessages, postChatMessage } from '$lib/server/team-chat';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
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
  // #793: a bounded WINDOW (newest CHAT_PAGE_SIZE), not the whole thread.
  const page = await loadChatMessages(gqlClient(locals.token), params.id, node.loc, { sort: chatSortKey(node) }).catch((err) => {
    console.error('[chat-page] messages query failed:', err);
    return { messages: [], total: 0, hasOlder: false, offset: 0 };
  });
  const messages = page.messages;

  // Compute fullUrn the way the node detail page does — through
  // `composeNodeUrn`, NOT by concatenating the memory URN with the loc.
  // Hand-rolling it produced `hrn:mem:<root>:<slug>:<loc>` for the team chat:
  // the memory's own `hrn:mem:` type word survived onto what is a NODE URN,
  // and the separator was v1 `::`. Both are exactly what hrn:node:hadronmemory.com:specs:cor:urn:010:01
  // forbids — `mem` vs `node` is not recoverable from the string, so the
  // badge was addressing a different entity class than the page it sat on.
  // The composer strips the memory's type word, emits `hrn:node:`, and keeps
  // the one case that must stay v1 (ownership chains) intact.
  const memoryUrn: string | undefined = parentData?.graph?.urn;
  const cleanLoc =
    memoryUrn && node.loc.startsWith(`${memoryUrn}:`)
      ? node.loc.slice(memoryUrn.length + 1)
      : node.loc;
  // Non-fatal: `composeNodeUrn` throws on a wrong-type/empty memory URN, and a
  // malformed URN badge must not 500 a page whose job is the transcript.
  let fullUrn = cleanLoc;
  if (memoryUrn && cleanLoc) {
    try {
      fullUrn = composeNodeUrn(memoryUrn, cleanLoc);
    } catch (err) {
      console.error('[chat-page] composeNodeUrn failed:', err);
    }
  }

  return {
    node,
    fullUrn,
    messages,
    hasOlder: page.hasOlder,
    chatOffset: page.offset,
    // #489 part 4 (@codex on PR #791): the App reference has to be HERE too,
    // not only on the node page. This is the surface a reader stays on — the
    // full transcript and composer — and it is one click from the node page's
    // "Full-screen chat" button. Rendering the App there and not here means the
    // affordance disappears exactly when the reader settles in, which
    // reintroduces the navigation gap the reference was added to close.
    //
    // Free: this route already runs NODE_BY_ID_QUERY, which now carries
    // memory.app. No extra round trip, no second query to keep in step.
    //
    // Not gated on isChatNode: this route only ever renders a chat (the loader
    // above refuses anything else), so the node IS the chat by the time we are
    // here. Null when the chat has no App, so the header renders it absent
    // rather than as an empty chip.
    chatApp: node.memory?.app ?? null,
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
