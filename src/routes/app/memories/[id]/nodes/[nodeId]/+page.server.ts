import { error, fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { withQuery } from '$lib/safeRedirect';
import { NODE_BY_ID_QUERY, NODE_QUERY, DELETE_NODE_MUTATION, CREATE_NODE_MUTATION, MOVE_NODE_MUTATION, CLONE_NODE_MUTATION, ORG_APP_INSTALLS_QUERY, RUN_TASK_APP_MUTATION, MEMORIES_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
// #868: every node write on this page goes through the door chooser. The
// mutation documents are deliberately NOT imported here — naming one directly
// is what `scripts/check-node-write-doors.mjs` fails.
import { assertNodeUpdateDoor, nodeUpdateDocument } from '$lib/server/nodeKindDoor';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { resolveWikilinks } from '$lib/server/wikilinks';
import { chatAuthorName, chatPostTarget, chatRootLocForMessage, chatSortKey, isChatMessageNode, isChatNode, loadChatMessages, postChatMessage, type ChatMessage, type ChatPage } from '$lib/server/team-chat';
import { isCanonicalNodeType } from '$lib/node-types';
import { outputFromNodeData, rowsFromNodeData, rowsToSpec } from '$lib/flow/extraction';
import { t } from '$lib/i18n/t';
import type { MemoryNode, NodeRevision } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { sendChatMessageSchema } from '$lib/forms/chat-message-schema';
import {
  nodeConvertToTaskSchema,
  nodeCreateParentSchema,
  nodeDeleteSchema,
  nodeDuplicateSchema,
  nodeMoveSchema,
  nodeTestFlowSchema,
  nodeUpdateEdgesSchema,
  nodeUpdateFlowSchema,
  nodeUpdateMetaSchema,
  parseValidatedEdges,
  parseValidatedFlowRows,
} from './schema';

type NodeMoveForm = Infer<typeof nodeMoveSchema, 'zod4'>;
type NodeTestFlowForm = Infer<typeof nodeTestFlowSchema, 'zod4'>;
type NodeDeleteForm = Infer<typeof nodeDeleteSchema, 'zod4'>;
type NodeCreateParentForm = Infer<typeof nodeCreateParentSchema, 'zod4'>;
type NodeUpdateMetaForm = Infer<typeof nodeUpdateMetaSchema, 'zod4'>;
type NodeDuplicateForm = Infer<typeof nodeDuplicateSchema, 'zod4'>;
type NodeConvertToTaskForm = Infer<typeof nodeConvertToTaskSchema, 'zod4'>;
type NodeUpdateFlowForm = Infer<typeof nodeUpdateFlowSchema, 'zod4'>;
type NodeUpdateEdgesForm = Infer<typeof nodeUpdateEdgesSchema, 'zod4'>;
type SendChatMessageForm = Infer<typeof sendChatMessageSchema, 'zod4'>;

const nodeMoveFormAdapter = zod4(nodeMoveSchema);
const nodeTestFlowFormAdapter = zod4(nodeTestFlowSchema);
const nodeDeleteFormAdapter = zod4(nodeDeleteSchema);
const nodeCreateParentFormAdapter = zod4(nodeCreateParentSchema);
const nodeUpdateMetaFormAdapter = zod4(nodeUpdateMetaSchema);
const nodeDuplicateFormAdapter = zod4(nodeDuplicateSchema);
const nodeConvertToTaskFormAdapter = zod4(nodeConvertToTaskSchema);
const nodeUpdateFlowFormAdapter = zod4(nodeUpdateFlowSchema);
const nodeUpdateEdgesFormAdapter = zod4(nodeUpdateEdgesSchema);
const sendChatMessageFormAdapter = zod4(sendChatMessageSchema);

function parseValidatedFlowPayload(value: string): Record<string, unknown> | undefined {
  if (value === '') return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Validated flow payload failed to parse: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Soft cap on the Node.data payload, mirrored client-side in +page.svelte.
// Keeps a pathological paste from hitting the adapter-node 512KB body limit
// (an opaque error) and gives a clean 400 instead. 256KB is far above any
// realistic data blob. NOTE: a body that already exceeds the framework limit
// is rejected before this action runs — this guards the sub-limit range and
// non-browser callers that skip the client-side check.
const DATA_MAX = 262144; // 256 KB

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  // parent() and the node read are independent — fetch in parallel.
  // SvelteKit memoizes parent() across the load, so the guard's later call
  // does not refetch; passing a thunk that resolves to the already-fetched
  // value keeps the guard signature reusable without an extra round-trip.
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);
  // #790: `error(404, …)`, not a bare `throw new Error`. The bare throw rendered
  // "500 — Something went wrong / Internal Error" for a node that simply is not
  // there, which is wrong in two directions at once:
  //
  //   - It tells the user the PORTAL is broken. Someone following a stale or
  //     shared link to a deleted node reports an outage rather than a dead link,
  //     and the message gives them nothing to act on.
  //   - It is a DIFFERENT observable response from the 404 this route emits when
  //     a node exists but is unreadable. `node(ref:)` returns null for both on
  //     purpose — that is the existence-hiding the server gate is specified to
  //     produce — and answering 500 for one and 404 for the other hands the
  //     distinction back to anyone probing.
  //
  // Matches the memory layout's `throw error(404, 'Memory not found')` one level
  // up, which has always been right; this route was the outlier.
  if (!data.node) throw error(404, 'Node not found');
  const node = data.node;

  // #237: the URL-acceptance counterpart to #234's URL-emission fix. The
  // route is scoped by `[id]` (the memory id) but `node(ref:)` resolves the PK alone, so a
  // mismatched URL (stale tab after a node move, manual edit, future link
  // bug, etc.) would silently render a foreign node under the current
  // memory's basePath. Redirect to the correct memory's URL so the user
  // lands on the right page — matches the R-9 inaccessible-deep-link
  // pattern in +layout.server.ts. If the user can't access node.memoryId,
  // the redirected memory layout will throw "Memory not found" — a clean
  // failure mode rather than the silent wrong-node render.
  // #761: carry `url.search`. This hop is conditional and off the resolver's
  // happy path — a URN-resolved node arrives with the server's own memoryId, so
  // the ids match and this never fires. It fires for the case #237 describes: a
  // link written before the node moved. That link is precisely the one most
  // likely to be an old shared deep link with state on it, so a
  // canonicalization must be transparent to it rather than quietly resetting
  // the reader to the node's default tab.
  if (node.memoryId !== params.id) {
    redirect(303, withQuery(`/app/memories/${node.memoryId}/nodes/${params.nodeId}`, url.search));
  }

  // Build breadcrumb from loc segments — look up ancestor nodes within THIS
  // memory only. Resolving by loc alone (via NODE_QUERY) would cross-pollinate
  // with any other memory the caller can access that happens to share the loc,
  // producing breadcrumb links like memories/A/nodes/<B's PK>. See #234.
  const memoryNodes = parentData.graphNodes ?? [];
  // Read here rather than at the wikilink call below: the breadcrumb needs
  // `graph.urn` too, to qualify an ancestor's loc into a real node URN.
  const { graph, nodesFailed } = parentData as {
    graph?: { urn?: string | null } | null;
    nodesFailed?: boolean;
  };
  const ancestorByLoc = new Map<string, { id: string; name: string | null }>();
  for (const n of memoryNodes) {
    if (n.memoryId === params.id) ancestorByLoc.set(n.loc, { id: n.id, name: n.name ?? null });
  }

  // A memory whose URN the layout could not supply (a failed graph read) falls
  // back to the bare loc rather than rendering nothing — "couldn't qualify it"
  // is not "there is no address".
  const ancestorUrn = (loc: string): string | null => {
    if (!graph?.urn) return null;
    try {
      return composeNodeUrn(graph.urn, loc);
    } catch {
      return null;
    }
  };

  const parts = node.loc.split(':');
  const breadcrumb: Array<{
    label: string;
    path: string;
    nodeId: string | null;
    title?: string;
  }> = [];

  for (let i = 0; i < parts.length; i++) {
    const ancestorLoc = parts.slice(0, i + 1).join(':');
    let nodeId: string | null = null;
    // An ancestor that EXISTS shows its NAME, like every other segment of this
    // crumb — the memory renders as "Holger Personal Taxes", and the leaf
    // renders `node.name`. Ancestors were the only slugs left, and not by
    // choice: the crumb began as pure loc-splitting, when a slug was the only
    // thing available, and the commit that added this very lookup (to make
    // ancestors hotlinks, #124) carried `label: parts[i]` forward unchanged.
    // The effect was that one node had two identities — a parent titled
    // "Form: FBAR (FinCEN Form 114)" on its own page became `form-fbar` the
    // moment you clicked into a child.
    //
    // The name is free: `graphNodes` already carries it and the layout has
    // already paged it to completion, so this is the same map lookup with a
    // second field.
    let label = parts[i];
    let title: string | undefined;
    if (i < parts.length - 1) {
      const hit = ancestorByLoc.get(ancestorLoc);
      nodeId = hit?.id ?? null;
      if (hit?.name) {
        label = hit.name;
        // @codex on #853: the ADDRESS stays reachable on hover, and it is the
        // fully-qualified node URN rather than the bare loc. Substituting the
        // name removes the only place the address was visible, and a bare loc
        // would not replace it — a bare loc does not say which memory it
        // belongs to once pasted into a CLI call, an MCP tool or a message,
        // which is the whole reason this repo gates bare-loc citations.
        //
        // NOT a `Urn` component here, which is what the review suggested.
        // `hrn:node:hadronmemory.com:hadron-portal:review:render-urn` is about
        // a view that NAMES another entity — a detail page, a table cell — and
        // this crumb already links to the ancestor's own page, where its URN is
        // rendered properly. A URN chip per segment would also make the trail
        // unreadable and undo the truncation this change is half about.
        title = ancestorUrn(ancestorLoc)
          ? `${hit.name} — ${ancestorUrn(ancestorLoc)}`
          : `${hit.name} — ${ancestorLoc}`;
      }
    }
    // A segment with NO node keeps its slug, necessarily — there is no name to
    // show. That is also what the "+ Create parent node" affordance below the
    // crumb reads (`seg.label` seeds the new node's name), and it only renders
    // when `!seg.nodeId`, i.e. exactly when no substitution happened. The two
    // cannot drift apart: the branch that sets a name is the branch that sets
    // a nodeId.
    breadcrumb.push({ label, path: ancestorLoc, nodeId, title });
  }

  // #374 / spec hrn:node:hadronmemory.com:specs:cor:urn:020:01 — resolve the `[[loc]]` wikilinks in the body
  // and abstract so the renderer can make them clickable (and mark the dangling
  // ones visibly broken). Bare locs resolve against `memoryNodes` above at zero
  // cost; only a cross-memory `[[org::memory::loc]]` costs a round-trip, so
  // this is free for the overwhelming majority of nodes. Started here and
  // awaited below so it overlaps the remaining fetches.
  // `nodesFailed` matters as much as the node list: the layout returns an empty
  // `graphNodes` for BOTH an empty memory and a failed graph fetch, and without
  // the flag an outage would repaint every valid link as corpus rot.
  const wikilinksPromise = resolveWikilinks(
    gqlClient(locals.token),
    [node.content, node.abstract],
    { memoryId: params.id, memoryUrn: graph?.urn ?? null, nodes: memoryNodes, nodesFailed },
  );

  // "Test flow" (#478 phase 3): a runnable node can be executed as a MANUAL
  // headless run via runTask(appRef:) — the button needs the org's Apps to
  // run as. Best-effort: only offered to org members (org present) on
  // runnable nodes; a fetch failure just hides the button (auxiliary UI,
  // not the page's core load — hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
  const org = (parentData as { org?: { id: string } | null }).org;
  let testFlowApps: Array<{ id: string; name: string }> = [];
  if (node.isRunnable && org?.id) {
    try {
      const apps = await fetchAllItems<{ id: string; name: string }>(
        gqlClient(locals.token), ORG_APP_INSTALLS_QUERY, 'apps', { orgId: org.id },
      );
      testFlowApps = apps.map((a) => ({ id: a.id, name: a.name }));
    } catch (e) {
      console.warn('[node-detail] test-flow app list failed:', e);
    }
  }

  // #512: the memories the Move dialog's picker can target. STREAMED (not
  // awaited) so it never blocks the node page render — the dialog may never
  // open. Best-effort: a fetch failure degrades to an empty picker and the
  // free-text URN input still works. System-class memories are excluded (user
  // nodes don't move into them).
  type PickMemory = { id: string; name: string; urn: string; visibility: string | null; class: string | null };
  const memories = fetchAllItems<PickMemory>(gqlClient(locals.token), MEMORIES_QUERY, 'memories')
    .then((all) => all.filter((m) => m.class !== 'system'))
    .catch((e) => {
      console.warn('[node-detail] memory picker list failed:', e);
      return [] as PickMemory[];
    });

  // #529: the node's revision history for the History tab (#623 rename).
  // STREAMED (the tab may never be opened) and best-effort. An async IIFE keeps
  // it unawaited (streamed) while capturing BOTH a synchronous throw and an
  // async rejection (PR #530 review). Resolves to a discriminated result so the
  // tab can tell "no revisions" from "couldn't load" — a silent [] on failure
  // masks real errors (schema drift, a down server) as an empty history.
  const revisions = (async (): Promise<{ ok: boolean; items: NodeRevision[] }> => {
    try {
      const r = await gqlClient(locals.token).request<{ nodeRevisions: NodeRevision[] }>(
        NODE_REVISIONS_QUERY,
        { nodeRef: node.id, limit: 100 },
      );
      return { ok: true, items: r?.nodeRevisions ?? [] };
    } catch (e) {
      console.warn('[node-detail] revision history failed:', e);
      return { ok: false, items: [] };
    }
  })();

  // A chat node (`nodeType: 'chat'`, or the legacy `team-chat` tag) is readable
  // two ways: as a node (the usual tabs) and as a chat thread. The Chat tab
  // renders the same bubbles as the standalone /chat view, so it is the node's
  // default tab and is AWAITED rather than streamed — it is the primary content
  // for those nodes. Every other node pays nothing. Best-effort: an empty thread
  // beats failing the whole page.
  const isChat = isChatNode(node);
  // Whether the composer has anywhere to send. Derived from the NODE (the same
  // input the action re-derives it from), not from the parent layout's memory —
  // a partial/streamed layout must not be able to hide a composer the action
  // would happily accept, or offer one it would reject.
  const canPostChat = chatPostTarget(node).kind !== 'none';
  // #793: a bounded WINDOW (the newest CHAT_PAGE_SIZE), not the whole thread.
  // The page also carries `hasOlder` so the Chat tab can offer scrollback
  // instead of silently presenting a window as the complete transcript.
  const chatMessagesPromise: Promise<ChatPage | null> = isChat
    ? loadChatMessages(gqlClient(locals.token), params.id, node.loc, { sort: chatSortKey(node) }).catch((e) => {
        console.warn('[node-detail] chat messages failed:', e);
        return { messages: [], total: 0, hasOlder: false, offset: 0 };
      })
    : Promise.resolve(null);

  // #725/#726: the other end of a chat. A MESSAGE is marked in the header the
  // way a chat root is, and offers "Open chat" — the thread it belongs to is
  // the context a single bubble is missing, and nothing else on this page
  // links to it.
  const isChatMessage = isChatMessageNode(node);
  // The chat ROOT's node id, resolved from the shared layout payload the
  // breadcrumb already walks — so this costs no round trip. Two things are
  // deliberately checked rather than assumed:
  //   - the ancestor must actually BE a chat. A `<x>:messages:<y>` address does
  //     not make `<x>` a chat node, and an "Open chat" landing on an ordinary
  //     node would be a link that lies about where it goes.
  //   - `memoryId === params.id`, the same scoping the breadcrumb applies (#234)
  //     — a loc is unique per memory, not globally.
  // When `graphNodes` is empty because the graph read FAILED (`nodesFailed`),
  // the root cannot be resolved and the action is not offered. That withholds
  // an affordance rather than asserting the message has no chat, and it is the
  // same degradation the breadcrumb already accepts on the same input.
  const chatRootLoc = isChatMessage ? chatRootLocForMessage(node.loc) : null;
  const chatRoot = chatRootLoc
    ? memoryNodes.find((n) => n.memoryId === params.id && n.loc === chatRootLoc)
    : undefined;
  const openChat = chatRoot && isChatNode(chatRoot)
    ? { nodeId: chatRoot.id, loc: chatRoot.loc, name: chatRoot.name ?? chatRoot.loc }
    : null;

  // #489 part 4: the App a chat belongs to, so a reader who arrived by URN can
  // reach it. Before this, the page named the App only by accident — the
  // server writes "Team chat — <App>" into the node's `description`, which the
  // header renders verbatim, so the App was visible as PROSE and would vanish
  // if anyone edited that string. Nothing on the page linked to the App at all.
  //
  // Deliberately a reference rather than a REDIRECT, per @Holger's ruling and
  // the precedent three lines below `canonicalPath`'s node case: the worker URN
  // gets its own page rather than a redirect to the App's Staff tab because
  // "a redirect would be both churn and the wrong answer" (#735/#991/#737).
  // That holds harder here — this page has the thread, a working composer, the
  // node's URN, revisions and edges, so redirecting would REMOVE the surface a
  // node URN asked for. See `hrn:node:hadronmemory.com:hadron-portal:findings:filtering-a-view-breaks-the-links-into-it`.
  //
  // Gated on `isChat` alone, not on the team-chat loc: an agent chat in an App
  // memory has the same reader with the same problem. An ordinary node is
  // excluded because it does not NAME its App — `hrn:node:hadronmemory.com:hadron-portal:review:render-urn` is about
  // rendering the URN of an entity a view already refers to, not about
  // surfacing every ancestor.
  const chatApp = isChat ? (node.memory?.app ?? null) : null;

  const flowRows = rowsFromNodeData(node.data);
  const output = outputFromNodeData(node.data);
  // #656: an edge whose target is null (unreadable memory) has no targetId to
  // expose. The page blocks edge editing while one is present, so this list is
  // never round-tripped as a replacement set.
  const outgoingEdges = node.outgoingEdges
    .filter((e) => e.target != null)
    .map((e) => ({ targetId: e.target!.id, name: e.name ?? null }));
  const [moveForm, testFlowForm, deleteForm, createParentForm, updateMetaForm, duplicateForm, convertToTaskForm, flowForm, edgesForm, sendChatMessageForm] = await Promise.all([
    superValidate<NodeMoveForm>({ target: '' }, nodeMoveFormAdapter, { errors: false }),
    superValidate<NodeTestFlowForm>(
      { appId: '', orgId: org?.id ?? '', payload: '' },
      nodeTestFlowFormAdapter,
      { errors: false },
    ),
    superValidate<NodeDeleteForm>({ hard: false }, nodeDeleteFormAdapter, { errors: false }),
    superValidate<NodeCreateParentForm>({ loc: '', name: '' }, nodeCreateParentFormAdapter, { errors: false }),
    superValidate<NodeUpdateMetaForm>({
      name: node.name ?? '',
      nodeType: node.nodeType ?? '',
      description: node.description ?? '',
      alias: node.alias ?? '',
      seq: node.seq ?? null,
      tags: (node.tags ?? []).join(', '),
      isRunnable: node.isRunnable ?? false,
      loc: node.loc,
    }, nodeUpdateMetaFormAdapter, { errors: false }),
    superValidate<NodeDuplicateForm>({}, nodeDuplicateFormAdapter, { errors: false }),
    superValidate<NodeConvertToTaskForm>({}, nodeConvertToTaskFormAdapter, { errors: false }),
    superValidate<NodeUpdateFlowForm>({
      extractionRows: JSON.stringify(flowRows),
      outputWriteTo: output?.writeTo ?? '',
      outputMode: output?.mode ?? 'replace',
    }, nodeUpdateFlowFormAdapter, { errors: false }),
    superValidate<NodeUpdateEdgesForm>({
      edges: JSON.stringify(outgoingEdges),
    }, nodeUpdateEdgesFormAdapter, { errors: false }),
    superValidate<SendChatMessageForm>({}, sendChatMessageFormAdapter, { errors: false }),
  ]);

  const wikilinks = await wikilinksPromise;
  const chatMessages = await chatMessagesPromise;

  return {
    node,
    isChat,
    isChatMessage,
    openChat,
    chatApp,
    chatMessages: chatMessages?.messages ?? null,
    chatHasOlder: chatMessages?.hasOlder ?? false,
    chatOffset: chatMessages?.offset ?? 0,
    canPostChat,
    sendChatMessageForm,
    // `?tab=` deep-links a specific tab (the page falls back to its own default
    // for an unknown value). Used by the full-screen chat's "View node details"
    // link, which must land on Content — a chat node opens on Chat otherwise.
    initialTab: url.searchParams.get('tab'),
    breadcrumb,
    wikilinks,
    testFlowApps,
    memories,
    revisions,
    moveForm,
    testFlowForm,
    deleteForm,
    createParentForm,
    updateMetaForm,
    duplicateForm,
    convertToTaskForm,
    flowForm,
    edgesForm,
  };
};

export const actions: Actions = {
  // #237 review follow-up: every mutating action below derives `memoryId`
  // from the node fetched by PK rather than from `params.gid`. The load
  // guard above only protects GETs — form actions run BEFORE `load`, so
  // a POST to a stale-URL (different memory in the URL than where the
  // node actually lives) would otherwise mutate / delete / move against
  // the wrong memory. Deriving memoryId from the fetched node preserves
  // the user's input (their submission goes to the correct destination)
  // and the post-action navigation re-runs `load`, whose redirect then
  // fixes the URL on screen.
  createParent: async ({ request, params, locals }) => {
    const form = await superValidate<NodeCreateParentForm>(
      await request.formData(),
      nodeCreateParentFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const { loc, name } = form.data;
    const client = gqlClient(locals.token);
    // #237: derive memoryId from the anchor (URL) node so a stale URL
    // doesn't write the new parent into the wrong memory.
    const { node: anchorNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    );
    if (!anchorNode) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
    try {
      const res = await client.request<{ createNode: { id: string } }>(CREATE_NODE_MUTATION, {
        input: { memoryId: anchorNode.memoryId, loc, name, nodeType: 'info' },
      });
      return {
        createdParentId: res.createNode.id,
        ...message(form, { type: 'success', text: t('node.create-parent.saved', 'Parent node created.') }),
      };
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to create parent node') }, { status: 500 });
    }
  },

  updateMeta: async ({ request, params, locals }) => {
    const form = await superValidate<NodeUpdateMetaForm>(
      await request.formData(),
      nodeUpdateMetaFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const client = gqlClient(locals.token);

    const { node: currentNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    );
    if (!currentNode) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });

    const name = form.data.name;
    // Accept only a canonical type or the node's existing one — otherwise keep
    // the current type. Guards against a crafted POST writing an arbitrary
    // nodeType (the dropdown only offers canonical values), and a blank field
    // never clears it.
    const submittedType = form.data.nodeType;
    const nodeType =
      isCanonicalNodeType(submittedType) || submittedType === currentNode.nodeType
        ? submittedType
        : currentNode.nodeType;
    const description = form.data.description || null;
    const alias = form.data.alias || null;
    const seq = form.data.seq;
    const tagsStr = form.data.tags;
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const isRunnable = form.data.isRunnable;
    const newLoc = form.data.loc;

    // Move if loc changed. #237: route the move through the node's OWN
    // identity — #564 reshaped moveNode to sourceRef (the PK) + targetUrn
    // (the full destination node URN, composed from the node's own memory
    // urn), so a stale URL can't redirect the move anyway. An occupied
    // destination fails loudly with NODE_ALREADY_EXISTS (#501).
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;

    // #868: updateMeta is the ONE action here that can change a governance
    // signal, so its resulting kind is the SUBMITTED `isRunnable` merged over
    // the node. Un-ticking Runnable on a task node is still a TASK-door write
    // (before ∪ after), a direction #867's submitted-value-only routing got
    // wrong.
    //
    // Chosen BEFORE the move, not after (@copilot on PR #869). The chooser can
    // refuse — a node matching two governed kinds has no door — and a refusal
    // raised after `moveNode` has committed leaves the node relocated with none
    // of the edit applied, reported as a 500. Nothing below needs the move to
    // have happened first, so the refusal costs nothing when it comes first and
    // costs a half-applied edit when it comes second.
    const input = { memoryId: currentNode.memoryId, loc, name, nodeType, description, alias, seq: Number.isNaN(seq) ? null : seq, tags, isRunnable };
    try {
      assertNodeUpdateDoor(currentNode, input);
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to save') }, { status: 500 });
    }

    if (loc !== currentNode.loc) {
      if (!currentNode.memory?.urn) {
        return message(form, { type: 'error', text: 'Node has no memory URN to move by.' }, { status: 500 });
      }
      try {
        await client.request(MOVE_NODE_MUTATION, {
          sourceRef: currentNode.id,
          targetUrn: composeNodeUrn(currentNode.memory.urn, loc),
        });
      } catch (e: unknown) {
        // An occupied destination is a 409 Conflict, not a 500 — matches the
        // /api/nodes/move endpoint and keeps it out of error monitoring.
        const status = extractGqlErrorCode(e) === 'NODE_ALREADY_EXISTS' ? 409 : 500;
        return status === 409
          ? setError(form, 'loc', extractGqlError(e, 'Failed to move node'), { status })
          : message(form, { type: 'error', text: extractGqlError(e, 'Failed to move node') }, { status });
      }
    }

    try {
      await client.request(nodeUpdateDocument(currentNode, input), { input });
      return message(form, { type: 'success', text: t('node.meta.saved', 'Node settings saved.') });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to save') }, { status: 500 });
    }
  },

  delete: async ({ request, params, locals }) => {
    // Optional hard delete (#503): the menu's confirm dialog sends hard=true
    // to purge the row rather than soft-delete it. Absent (Settings danger
    // zone) → soft delete, the safe default.
    const form = await superValidate<NodeDeleteForm>(
      await request.formData(),
      nodeDeleteFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const hard = form.data.hard;
    // Load the node to get its loc AND its actual memoryId (#237).
    const data = await gqlClient(locals.token).request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    );
    if (!data.node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
    const node = data.node;
    try {
      // #542: deleteNode takes a single nodeRef — pass the resolved node's PK.
      await gqlClient(locals.token).request(DELETE_NODE_MUTATION, { nodeRef: node.id, hard });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to delete') }, { status: 500 });
    }
    // Redirect to the *actual* memory's list — not the URL's gid, which
    // may have been stale.
    redirect(303, `/app/memories/${node.memoryId}/nodes`);
  },

  // Chat tab composer. Mirrors the standalone /chat page's `sendMessage`
  // (same schema, same `_kind`) and goes through the same team-chat module, so
  // a message sent from either surface lands identically.
  sendChatMessage: async ({ request, params, locals }) => {
    const form = await superValidate<SendChatMessageForm>(await request.formData(), sendChatMessageFormAdapter);
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return message(form, { type: 'error', text: 'Chat node not found' }, { status: 404 });
      if (!isChatNode(node)) {
        return message(form, { type: 'error', text: 'This node is not a chat.' }, { status: 400 });
      }
      if (!locals.user) return message(form, { type: 'error', text: 'Not authenticated' }, { status: 401 });

      // #237: the target is derived from the fetched node, not the URL, which
      // may be stale. `none` means the message would land in some OTHER thread
      // (or nowhere) — refuse rather than report a success that isn't one.
      const target = chatPostTarget(node);
      if (target.kind === 'none') {
        return message(
          form,
          { type: 'error', text: "This chat isn't attached to an app, so there's nowhere to post from here." },
          { status: 400 },
        );
      }
      await postChatMessage(client, {
        target,
        memoryId: node.memoryId,
        chatLoc: node.loc,
        author: chatAuthorName(locals.user),
        content: form.data.content,
      });
      return message(form, { type: 'success', text: 'Message sent.' });
    } catch (e: unknown) {
      console.error('[node-detail] send chat message failed:', e);
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to send message') },
        { status: 500 },
      );
    }
  },

  updateContent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const content = String(fd.get('content') ?? '');

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      // #868: this edit touches neither governance signal, so the resulting
      // kind is the node's CURRENT one — which is why the fetched node, not the
      // input, decides the door.
      const input = {
        // #237: memoryId from the node, not the URL. Selects the target
        // together with loc; omitted fields (name, description, …) are
        // preserved by updateNode.
        memoryId: node.memoryId,
        loc: node.loc,
        // #235 history: the old upsertNode resolver cleared omitted tags
        // (`input.tags ?? []`). updateNode preserves omitted tags, so
        // this explicit pass-through is no longer load-bearing — but it
        // is still correct (it round-trips the user's tags verbatim), so
        // it stays. The `?? []` guards a null-tags schema-shape
        // regression at runtime.
        tags: node.tags ?? [],
        content,
      };
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  updateAbstract: async ({ request, params, locals }) => {
    const fd = await request.formData();
    // Send the raw string; the server normalizes empty/whitespace-only to
    // null (spec 031) and recomputes abstractOriginHash from current
    // content (spec 032). Length cap (2000) is enforced server-side too,
    // with a client-side maxlength as the first line of defense.
    const abstract = String(fd.get('abstract') ?? '');

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      // #868: neither governance signal is touched — the door follows the
      // node's current kind. See updateContent.
      const input = {
        // #237: memoryId from the node, not the URL.
        memoryId: node.memoryId,
        loc: node.loc,
        // #235: explicit tags pass-through — no longer load-bearing
        // under updateNode, kept deliberately. See updateContent.
        tags: node.tags ?? [],
        abstract,
      };
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  // Node.data is a free-form JSON object/value surfaced on the Data tab.
  // The client posts the raw editor text; we parse it here so a malformed
  // body fails fast with a readable message instead of an opaque
  // GraphQL/Prisma error. The updateNode resolver feeds `data` straight
  // into a Prisma `Json?` column, which rejects a bare JS `null` (it wants
  // Prisma.DbNull / JsonNull) — so clearing the field isn't supported here:
  // both an empty body and a top-level JSON `null` are rejected, and we
  // never send `null` downstream. The client gates Save on the same rules;
  // these are the server-side backstop.
  updateData: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const raw = String(fd.get('data') ?? '').trim();
    if (raw === '') return fail(400, { error: 'No JSON provided' });
    if (raw.length > DATA_MAX) {
      return fail(400, { error: `JSON too large (max ${DATA_MAX / 1024} KB)` });
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON' });
    }
    if (data === null) return fail(400, { error: 'Top-level JSON null is not allowed' });

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      // #868: neither governance signal is touched — the door follows the
      // node's current kind. See updateContent.
      const input = {
        // #237: memoryId from the node, not the URL.
        memoryId: node.memoryId,
        loc: node.loc,
        // #235: explicit tags pass-through — no longer load-bearing
        // under updateNode, kept deliberately. See updateContent.
        tags: node.tags ?? [],
        data,
      };
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  // Flow tab (#478 phase 2): structured editors for data.extractionSpec and
  // data.output. Merges into the node's CURRENT data (fetched fresh here) so
  // saving the flow config never clobbers unrelated data keys. Validation
  // mirrors the server's reserved-name rules (exception/exceptions,
  // __-prefix) with human messages — the server re-validates at save and run
  // time; this is the earlier, friendlier gate the issue asks for.
  updateFlow: async ({ request, params, locals }) => {
    const form = await superValidate<NodeUpdateFlowForm>(
      await request.formData(),
      nodeUpdateFlowFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const rows = parseValidatedFlowRows(form.data.extractionRows);
    const writeTo = form.data.outputWriteTo;
    const mode = form.data.outputMode;

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });

      const merged: Record<string, unknown> = {
        ...(node.data && typeof node.data === 'object' && !Array.isArray(node.data) ? node.data : {}),
      };
      if (rows.length > 0) merged.extractionSpec = rowsToSpec(rows);
      else delete merged.extractionSpec;
      if (writeTo !== '') merged.output = { writeTo, mode };
      else delete merged.output;

      // #868: neither governance signal is touched — the door follows the
      // node's current kind. See updateContent.
      const input = {
        // #237: memoryId from the node, not the URL.
        memoryId: node.memoryId,
        loc: node.loc,
        // #235: explicit tags pass-through — see updateContent.
        tags: node.tags ?? [],
        data: merged,
      };
      await client.request(nodeUpdateDocument(node, input), { input });
      return message(form, { type: 'success', text: t('node.flow.saved', 'Flow settings saved.') });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Save failed') }, { status: 500 });
    }
  },

  // "Test flow" (#478 phase 3): mint a MANUAL run for this node via
  // runTask(urn, appRef:) with an optional JSON trigger payload, then
  // deep-link to the run detail (the walker executes in the background).
  testFlow: async ({ request, params, locals }) => {
    const form = await superValidate<NodeTestFlowForm>(
      await request.formData(),
      nodeTestFlowFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    // Optional trigger payload — reaches conditions/templates at
    // message.data.<field>, so it must be a JSON OBJECT (named fields).
    const appId = form.data.appId;
    const args = parseValidatedFlowPayload(form.data.payload);


    const client = gqlClient(locals.token);
    let runId: string;
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
      if (!node.memory?.urn) {
        return message(form, { type: 'error', text: 'Node has no memory URN to run by.' }, { status: 500 });
      }
      const urn = composeNodeUrn(node.memory.urn, node.loc);

      const res = await client.request<{ runTask: string }>(RUN_TASK_APP_MUTATION, {
        nodeRef: urn,
        args,
        appRef: appId,
        runAsSelf: false,
      });
      runId = res.runTask;
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to start the run') }, { status: 500 });
    }
    // #648: run detail is the canonical org-optional /app/apps/[appId]/runs/[runId].
    redirect(303, `/app/apps/${appId}/runs/${runId}`);
  },

  // Duplicate (#501 / hadron-server#564): cloneNode into `<loc>-copy` beside
  // the original, stepping to -copy-2… when the slot is taken (cloneNode
  // fails loudly with NODE_ALREADY_EXISTS — never overwrites). Redirects to
  // the new node's page.
  duplicate: async ({ request, params, locals }) => {
    const form = await superValidate<NodeDuplicateForm>(
      await request.formData(),
      nodeDuplicateFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const client = gqlClient(locals.token);
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
    if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
    if (!node.memory?.urn) {
      return message(form, { type: 'error', text: 'Node has no memory URN to clone by.' }, { status: 500 });
    }

    // Normalize the source loc first (PR-502 review): a legacy stored loc can
    // carry a URN prefix, and appending `-copy` to that then composing a URN
    // would double the prefix (hrn:node:<mem>::hrn:node:<mem>::foo-copy).
    const baseLoc = cleanLocInput(node.loc);
    let clonedId: string | null = null;
    for (let attempt = 1; attempt <= 5 && clonedId === null; attempt++) {
      const candidateLoc = attempt === 1 ? `${baseLoc}-copy` : `${baseLoc}-copy-${attempt}`;
      try {
        const res = await client.request<{ cloneNode: { id: string; memoryId: string } }>(
          CLONE_NODE_MUTATION,
          { sourceRef: node.id, targetUrn: composeNodeUrn(node.memory.urn, candidateLoc) },
        );
        clonedId = res.cloneNode.id;
      } catch (e: unknown) {
        // An occupied -copy slot just means "try the next suffix"; anything
        // else surfaces as-is.
        if (extractGqlErrorCode(e) !== 'NODE_ALREADY_EXISTS') {
          return message(form, { type: 'error', text: extractGqlError(e, 'Failed to duplicate node') }, { status: 500 });
        }
      }
    }
    if (clonedId === null) {
      return message(form, { type: 'error', text: 'Too many copies of this node already exist — rename one first.' }, { status: 409 });
    }
    redirect(303, `/app/memories/${node.memoryId}/nodes/${clonedId}`);
  },

  // Move (#503 / #489): relocate the node via moveNode's targetUrn — a full
  // destination node URN that may name a DIFFERENT memory (the server
  // resolves the memory by URN). The dialog submits the full URN; a bare loc
  // (no `::`) is accepted as a convenience and composed into the current
  // memory. moveNode keeps the node's PK across the move (even cross-memory),
  // so we redirect to it — the node page's load 303s to the destination
  // memory's URL when node.memoryId no longer matches params.id (#237 guard).
  move: async ({ request, params, locals }) => {
    const form = await superValidate<NodeMoveForm>(
      await request.formData(),
      nodeMoveFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
    if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
    if (!node.memory?.urn) {
      return message(form, { type: 'error', text: 'Node has no memory URN to move by.' }, { status: 500 });
    }

    // A fully-qualified node URN (has `::`, or an hrn:/urn: prefix) moves as-is
    // — possibly to another memory. A bare loc composes into the current
    // memory (same-memory rename/reparent).
    const raw = form.data.target;
    const isFullUrn = raw.includes('::') || /^(?:hrn|urn):node:/.test(raw);
    const targetUrn = isFullUrn ? raw : composeNodeUrn(node.memory.urn, cleanLocInput(raw));
    // No-op when the destination is where the node already lives. Normalize
    // both sides before comparing, because a pasted URN and the composed one
    // need not be spelled the same way:
    //   - the prefix may be absent (`hrn:node:` / `urn:node:` / bare are all
    //     valid targetUrn inputs), and
    //   - the GRAMMAR may differ. composeNodeUrn emits v2 (single colon) per
    //     hrn:node:hadronmemory.com:specs:cor:urn:010:01, while a URN pasted from an older screen or another
    //     tool may still be v1 (`::`). Both spellings denote the same node, so
    //     comparing them raw would miss the no-op and fire a pointless move.
    const bare = (u: string) =>
      u.replace(/^(?:hrn|urn):node:/, '').split('::').join(':');
    if (bare(targetUrn) === bare(composeNodeUrn(node.memory.urn, node.loc))) {
      return message(form, { type: 'success', text: t('node-actions.move.noop', 'Node is already at that destination.') });
    }

    try {
      await client.request(MOVE_NODE_MUTATION, { sourceRef: node.id, targetUrn });
    } catch (e: unknown) {
      // #656 (server #781/#784): a cross-memory subtree move can be REFUSED for
      // reasons that are the user's to fix — an encrypted source/destination, a
      // git-backed source, a chat-root in the subtree, or a node that violates
      // the destination memory's collection schema (BAD_USER_INPUT) — or because
      // the source changed under a concurrent write (CONFLICT). None of those
      // are server faults, so don't bury them in a generic 500: surface the
      // server's message verbatim on the `target` field (it names the offending
      // memory/node), the same way NODE_ALREADY_EXISTS already did.
      const code = extractGqlErrorCode(e);
      const error = extractGqlError(e, 'Failed to move node');
      const fieldStatus =
        code === 'NODE_ALREADY_EXISTS' ? 409
        : code === 'CONFLICT' ? 409
        : code === 'BAD_USER_INPUT' ? 400
        : null;
      return fieldStatus !== null
        ? setError(form, 'target', error, { status: fieldStatus })
        : message(form, { type: 'error', text: error }, { status: 500 });
    }
    redirect(303, `/app/memories/${node.memoryId}/nodes/${node.id}`);
  },

  // Convert to task (#503): flip isRunnable on so the node can be run headless.
  // updateNode preserves omitted fields, so this is a minimal patch — no
  // redirect; enhance re-runs load and the menu item drops off once it's a task.
  convertToTask: async ({ request, params, locals }) => {
    const form = await superValidate<NodeConvertToTaskForm>(
      await request.formData(),
      nodeConvertToTaskFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const client = gqlClient(locals.token);
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
    if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
    try {
      // The TASK KIND DOOR (server #1201). This action's whole purpose is to
      // produce a runnable node, which the generic surface refuses outright —
      // so "Convert to task" could never have worked since the doors landed.
      // Measured: every call returned "This write would produce a RUNNABLE
      // node, which only updateTaskNode may update."
      //
      // #867 named `UPDATE_TASK_NODE_MUTATION` here directly. It now goes
      // through the chooser like every other write on this page — not because
      // the answer changes (it does not; `isRunnable: true` is unconditional),
      // but because a hand-named door is a rule enforced by whoever reads this
      // file. Converting a node that is ALREADY governed some other way is the
      // case a fixed answer gets wrong, and the chooser refuses it loudly.
      const input = {
        memoryId: node.memoryId,
        loc: node.loc,
        // #235: explicit tags pass-through — see updateContent.
        tags: node.tags ?? [],
        isRunnable: true,
      };
      await client.request(nodeUpdateDocument(node, input), { input });
      return {
        convertedToTask: true,
        ...message(form, { type: 'success', text: t('node-actions.convert-to-task.saved', 'Node converted to a task.') }),
      };
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to convert node to a task') }, { status: 500 });
    }
  },

  updateEdges: async ({ request, params, locals }) => {
    // Replaces the full set of outgoing edges on this node. The client sends
    // a JSON-encoded array of { targetId, name } — we pass it through the
    // updateNode mutation, which replaces all outgoing edges atomically.
    const form = await superValidate<NodeUpdateEdgesForm>(
      await request.formData(),
      nodeUpdateEdgesFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    const edges = parseValidatedEdges(form.data.edges);

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(
        NODE_BY_ID_QUERY, { ref: params.nodeId },
      );
      if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
      // #656: this replaces the WHOLE outgoing set, and an edge whose target is
      // in a memory the caller can't read has no targetId to resubmit — so it
      // would be silently deleted. The page hides the editor in that case, but
      // this is the load-bearing check: it also covers a crafted POST and the
      // race where an endpoint becomes unreadable (or a cross-memory edge is
      // added by another writer) while the editor is open, which is exactly why
      // it's tested against the FRESH refetch above, not the page's snapshot.
      if ((node.outgoingEdges ?? []).some((e) => !e.target)) {
        return message(
          form,
          {
            type: 'error',
            text: t(
              'node.edges.blocked-unreadable',
              'This node has an edge into a memory you can’t access. Saving would remove it, so edge changes can’t be applied here.',
            ),
          },
          { status: 400 },
        );
      }
      // #868: neither governance signal is touched — the door follows the
      // node's current kind. See updateContent.
      const input = {
        // #237: memoryId from the node, not the URL.
        memoryId: node.memoryId,
        loc: node.loc,
        // #235: explicit tags pass-through — no longer load-bearing
        // under updateNode, kept deliberately. See updateContent.
        tags: node.tags ?? [],
        edges: edges.map((e) => ({
          targetId: e.targetId,
          name: e.name ?? null,
        })),
      };
      await client.request(nodeUpdateDocument(node, input), { input });
      return message(form, { type: 'success', text: t('node.edges.saved', 'Edges saved.') });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update edges') }, { status: 500 });
    }
  },

  reorder: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const updatesJson = String(fd.get('updates') ?? '');
    let updates: { loc: string; seq: number }[];
    try {
      updates = JSON.parse(updatesJson);
    } catch {
      return fail(400, { error: 'Invalid updates' });
    }

    const client = gqlClient(locals.token);
    // #237: derive memoryId from the URL's anchor node so a stale-URL
    // POST reorders within the actual memory, not the URL's gid.
    const { node: anchorNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    );
    if (!anchorNode) return fail(404, { error: 'Anchor node not found' });
    try {
      for (const u of updates) {
        // #335 (closes the #234 follow-up): scope the read to the anchor's
        // memory. Previously NODE_QUERY(loc:) was memory-blind, so a foreign
        // memory sharing the loc could win the resolver's first-match and feed
        // a wrong `name` into anchorNode.memoryId's row. Now it's pinned.
        const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { ref: u.loc, memoryRef: anchorNode.memoryId });
        if (!node) continue;
        // #868: the door is chosen PER SIBLING, from the node being written —
        // never from `anchorNode`, which is not one of them. A reorder mixes
        // kinds routinely: one task node among ordinary siblings is the common
        // case, and it is the whole reason a reorder failed at all.
        const input = {
          memoryId: anchorNode.memoryId,
          loc: u.loc,
          // #235: explicit tags pass-through — no longer load-bearing
          // under updateNode, kept deliberately. See updateContent.
          tags: node.tags ?? [],
          seq: u.seq,
        };
        await client.request(nodeUpdateDocument(node, input), { input });
      }
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Reorder failed' });
    }
  },
};
