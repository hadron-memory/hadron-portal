import { nodeWriteErrorText } from '$lib/node-role-refusal';
import { error, fail, isRedirect, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { classifyGqlError, extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/server/gqlError';
import { runStartError, runStartStatus } from '$lib/server/run-start-error';
import { runAgentChoice } from '$lib/run-agent';
import type { InstalledAgent } from '$lib/app-installed-agents';
import { includeRefusalOf, includeRefusalText } from '$lib/server/include-refusal';
import { fetchAllItems } from '$lib/server/paginate';
import { deletedEdgeEndpoints } from '$lib/server/deleted-edge-endpoints';
import { requireNonConsumer } from '$lib/server/guards';
import { withQuery } from '$lib/safeRedirect';
import { RECOVERY_NODE_QUERY, NODE_BY_ID_QUERY, NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY, NODE_QUERY, DELETE_NODE_MUTATION, CREATE_NODE_MUTATION, MOVE_NODE_MUTATION, CLONE_NODE_MUTATION, ORG_APPS_RUNNABLE_QUERY, RUN_TASK_APP_MUTATION, MEMORIES_QUERY, NODE_REVISIONS_QUERY, NODE_EDGE_REMOVALS_QUERY, NODE_PROVENANCE_QUERY, NODE_REVISIONS_PROVENANCE_QUERY, NODE_APPROVAL_QUERY, NODE_SIGNATURES_QUERY, REQUEST_SIGNATURE_MUTATION, APPROVE_NODE_MUTATION, VERIFY_NODE_QUERY } from '$lib/server/queries';
import { bindToRevision, type NodeProvenance, type ProvenanceResult } from '$lib/node-provenance';
import { bindMintToRevision, type NodeMintStatus } from '$lib/node-mint';
import { bindSignaturesToRevision, signatureRequestRefusalText, type NodeSignatureRead, type NodeSignatureStatus } from '$lib/node-signatures';
import { deploymentOffersSigning } from '$lib/server/signing-capability';
import { approvalRefusalStatus, approveRefusalText, bindApprovalToRevision, integrityText, verifyFailureText, type NodeApprovalRead, type NodeApprovalStatus, type NodeIntegrityCheck } from '$lib/node-approval';
// #868: every node write on this page goes through the door chooser. The
// mutation documents are deliberately NOT imported here — naming one directly
// is what `scripts/check-node-write-doors.mjs` fails.
import { assertNodeUpdateDoor, nodeUpdateDocument, NoNodeDoorError } from '$lib/server/nodeKindDoor';
import { roleUpdate } from '$lib/node-role';
import { nodeMetaSeed } from '$lib/node-meta-seed';
import { parseExpectedRevision } from '$lib/node-revision';
import { canonicalJson, isFingerprint, jsonFingerprint, parseDataSource, parsePropertiesSource, propertiesFingerprint, sameProperties } from '$lib/properties-source';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { resolveWikilinks } from '$lib/server/wikilinks';
import { loadAncestors } from '$lib/server/breadcrumb-ancestors';
import { loadCommentSummary, loadDiscussion, sendCommentWrite } from '$lib/server/comments';
import { COMMENT_NODE_TYPE, commentMoveRefusedText, type CommentSummary, type Discussion } from '$lib/comments';
import { chatAuthorName, chatPostTarget, chatRootLocForMessage, chatSortKey, chatMessageNodeTypes, isChatMessageNode, isChatNode, isTeamChannelChat, legacyThreadEvidence, loadChatMessages, postChatMessage, type ChatMessage, type ChatPage } from '$lib/server/team-chat';
import { isCanonicalNodeType } from '$lib/node-types';
import { outputFromNodeData, rowsFromNodeData, rowsToSpec } from '$lib/flow/extraction';
import { t } from '$lib/i18n/t';
import type { MemoryNode, NodeEdgeRemoval, NodeRevision } from '$lib/types';
import { readChildrenPage, type ChildRow } from '$lib/server/node-children';
import { isCapped } from '$lib/server/capped';

// nodeRevisions has no offset or cursor (hadron-server#2212): the history is one
// window of the newest revisions, and the History tab says when it came back full.
const REVISIONS_LIMIT = 100;
// nodeEdgeRemovals is the same one-window shape (server#2562), so it shares the
// window size and the full-window cue.
const REMOVALS_LIMIT = 100;
import type { Actions, PageServerLoad } from './$types';
import { loadSkillCheck } from '$lib/server/skill-check';
import { nodeStorageSeed, noWriteDoor, runnableBlockedBy, updateStorage } from './storage-action';
import { sendChatMessageFormId, sendChatMessageSchema } from '$lib/forms/chat-message-schema';
import {
  nodeApproveSchema,
  nodeConvertToTaskSchema,
  nodeCreateParentSchema,
  nodeDeleteSchema,
  nodeDuplicateSchema,
  nodeMoveSchema,
  nodeTestFlowSchema,
  nodeUpdateEdgesSchema,
  nodeUpdateFlowSchema,
  nodeUpdateMetaSchema,
  nodeVerifySchema,
  parseValidatedEdges,
  parseValidatedFlowRows,
  isFullyQualifiedNodeUrnInput,
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
type NodeApproveForm = Infer<typeof nodeApproveSchema, 'zod4'>;
type NodeVerifyForm = Infer<typeof nodeVerifySchema, 'zod4'>;
type SendChatMessageForm = Infer<typeof sendChatMessageSchema, 'zod4'>;

const nodeMoveFormAdapter = zod4(nodeMoveSchema);
const nodeTestFlowFormAdapter = zod4(nodeTestFlowSchema);
const nodeDeleteFormAdapter = zod4(nodeDeleteSchema);
const nodeCreateParentFormAdapter = zod4(nodeCreateParentSchema);
const nodeUpdateMetaFormAdapter = zod4(nodeUpdateMetaSchema);
const nodeDuplicateFormAdapter = zod4(nodeDuplicateSchema);
const nodeApproveFormAdapter = zod4(nodeApproveSchema);
const nodeVerifyFormAdapter = zod4(nodeVerifySchema);
// #992 (Chip's QA on #993): Superforms derives a form's id from its schema's
// SHAPE, and a `_kind`-only schema hashes the same whatever the literal: the
// verify form shared its id with Duplicate and Convert to task, so its result
// never reached its own message. Explicit ids keep each form's result its own.
const APPROVE_FORM_ID = 'approveNode';
const VERIFY_FORM_ID = 'verifyNode';
// #995: the same collision hid Convert to task's errors, which landed in
// Duplicate's form (both `_kind`-only). Per
// hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids.
const DUPLICATE_FORM_ID = 'duplicateNode';
const CONVERT_TO_TASK_FORM_ID = 'convertToTask';
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
  if (!data.node) {
    // #1159: not live, but possibly a retained tombstone this viewer may recover
    // (an "Include deleted" row opens here). recoveryNode answers null for anyone
    // who may not, so the 404 below stays the single answer for "missing" and
    // "not yours". A failed recovery read is also just "not found".
    const tomb = await gqlClient(locals.token)
      .request<{ recoveryNode?: { id: string; memoryId: string } | null }>(RECOVERY_NODE_QUERY, { nodeRef: params.nodeId })
      .then((r) => r?.recoveryNode ?? null)
      .catch(() => null);
    if (tomb) redirect(303, `/app/memories/${tomb.memoryId}/nodes/${params.nodeId}/deleted`);
    throw error(404, 'Node not found');
  }
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
  // Read here rather than at the wikilink call below: the breadcrumb needs
  // `graph.urn` too, to qualify an ancestor's loc into a real node URN.
  const { graph } = parentData as {
    graph?: { urn?: string | null } | null;
  };
  // portal#1433: the layout loads no node list (`nodesOff`, portal#1524), so
  // the ancestors come from one bounded `nodeBatch` of their URNs and the
  // wikilink targets from their own bounded read. Both start here so they run
  // in parallel; the wikilinks are awaited further down.
  const ancestorsPromise = loadAncestors(gqlClient(locals.token), { id: params.id, urn: graph?.urn }, node.loc);
  // #374 / spec hrn:node:hadronmemory.com:specs:cor:urn:020:01 — resolve the `[[loc]]` wikilinks in the body
  // and abstract so the renderer can make them clickable (and mark the dangling
  // ones visibly broken). Nothing is read for a node with no links, which is
  // the overwhelming majority. A target that could not be checked renders as
  // an unchecked link, never as "no node" (the old `nodesFailed` degrade).
  const wikilinksPromise = resolveWikilinks(
    gqlClient(locals.token),
    [node.content, node.abstract],
    { memoryId: params.id, memoryUrn: graph?.urn ?? null },
  );
  const { byLoc: ancestorByLoc, known: ancestorsKnown } = await ancestorsPromise;

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
    // The name is free: the ancestor lookup (`loadAncestors`) already returns
    // it, so this is the same map lookup with a second field.
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

  // "Test flow" (#478 phase 3): a runnable node can be executed as a MANUAL
  // headless run via runTask(appRef:) — the button needs the org's Apps to
  // run as. Best-effort: only offered to org members (org present) on
  // runnable nodes; a fetch failure just hides the button (auxiliary UI,
  // not the page's core load — hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
  const org = (parentData as { org?: { id: string } | null }).org;
  // `agents` is the picker's options (#1444): null unless the App has several
  // installed Agents, where the server would refuse a run that names none.
  let testFlowApps: Array<{ id: string; name: string; agents: InstalledAgent[] | null }> = [];
  if (node.isRunnable && org?.id) {
    try {
      const apps = await fetchAllItems<{ id: string; name: string; appAgents: Array<{ agent: InstalledAgent | null }> | null }>(
        gqlClient(locals.token), ORG_APPS_RUNNABLE_QUERY, 'apps', { orgId: org.id },
      );
      testFlowApps = apps.map((a) => ({ id: a.id, name: a.name, agents: runAgentChoice(a.appAgents) }));
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
  const isComment = node.nodeType === COMMENT_NODE_TYPE;
  const revisions = (async (): Promise<{ ok: boolean; items: NodeRevision[]; capped?: boolean; nodeId?: string }> => {
    if (isComment) return { ok: true, items: [] };
    try {
      const r = await gqlClient(locals.token).request<{ nodeRevisions: NodeRevision[] }>(
        NODE_REVISIONS_QUERY,
        { nodeRef: node.id, limit: REVISIONS_LIMIT },
      );
      const items = r?.nodeRevisions ?? [];
      return { ok: true, items, capped: isCapped(items.length, REVISIONS_LIMIT), nodeId: node.id };
    } catch (e) {
      console.warn('[node-detail] revision history failed:', e);
      return { ok: false, items: [] };
    }
  })();

  // portal#1355: edge-removal audit entries (server#2562, hrn:node:hadronmemory.com:specs:cor:dmo:010:04) for
  // the History tab. STREAMED and best-effort like the revision history, with
  // the same discriminated result so the tab can tell "none recorded" from
  // "couldn't load" — a silent [] on failure would mask a real error as an
  // absent audit trail. A comment never held edges of its own, so its page
  // asks for none (mirroring the revisions read above).
  const edgeRemovals = (async (): Promise<{ ok: boolean; items: NodeEdgeRemoval[]; capped?: boolean }> => {
    if (isComment) return { ok: true, items: [] };
    try {
      const r = await gqlClient(locals.token).request<{ nodeEdgeRemovals: NodeEdgeRemoval[] }>(
        NODE_EDGE_REMOVALS_QUERY,
        { nodeRef: node.id, limit: REMOVALS_LIMIT },
      );
      const items = r?.nodeEdgeRemovals ?? [];
      return { ok: true, items, capped: isCapped(items.length, REMOVALS_LIMIT) };
    } catch (e) {
      console.warn('[node-detail] edge-removal audit failed:', e);
      return { ok: false, items: [] };
    }
  })();

  // #914: authorship + advisory content validation, for the node and for its
  // History rows. Each is its OWN streamed read (see NODE_PROVENANCE_QUERY for
  // why it never rides on the node or history reads), and a failure resolves to
  // { ok: false } so the display says "couldn't load" instead of guessing.
  const provenance = (async (): Promise<ProvenanceResult<NodeProvenance>> => {
    try {
      const r = await gqlClient(locals.token).request<{ node: NodeProvenance | null }>(
        NODE_PROVENANCE_QUERY,
        { ref: node.id },
      );
      // Read AFTER the node, so a concurrent edit can land in between: shown
      // only when it describes the revision this page rendered.
      return r?.node ? bindToRevision({ ok: true, value: r.node }, node.revision) : { ok: false };
    } catch (e) {
      console.warn('[node-detail] provenance failed:', e);
      return { ok: false };
    }
  })();
  // #992: approval and mint status, their own streamed read for the same
  // reasons, and bound to the rendered revision the same way. ONE request;
  // each result is derived from it, so the two can never describe different
  // revisions. `undefined` marks a failed read.
  const governanceRead = (async (): Promise<(NodeApprovalRead & { mintStatus?: NodeMintStatus | null }) | null | undefined> => {
    try {
      const r = await gqlClient(locals.token).request<{ node: (NodeApprovalRead & { mintStatus?: NodeMintStatus | null }) | null }>(
        NODE_APPROVAL_QUERY,
        { ref: node.id },
      );
      return r?.node ?? null;
    } catch (e) {
      console.warn('[node-detail] approval status failed:', e);
      return undefined;
    }
  })();
  const approval: Promise<ProvenanceResult<NodeApprovalStatus>> = governanceRead.then((read) =>
    read === undefined ? { ok: false } : bindApprovalToRevision(read, node.revision),
  );
  const mint: Promise<ProvenanceResult<NodeMintStatus>> = governanceRead.then((read) =>
    read === undefined ? { ok: false } : bindMintToRevision(read, node.revision),
  );
  // portal#1022: passkey signatures, streamed and bound like the approval but
  // a request of their own, so a refusal or a failure only leaves the
  // signatures unshown. The field exists only while the deployment offers
  // signing (hadron-server#1895/#1918); with signing off, selecting it fails
  // validation, so no signature query goes out at all. The same answer gates
  // the Sign affordance (returned as signingOffered, read by the
  // requestSignature action), so the button and the query can never disagree
  // about whether the deployment offers signing.
  const signingOffered = deploymentOffersSigning(locals.token);
  const signatures: Promise<ProvenanceResult<NodeSignatureStatus>> = (async () => {
    if (!(await signingOffered)) return { ok: false } as const;
    try {
      const r = await gqlClient(locals.token).request<{ node: NodeSignatureRead | null }>(NODE_SIGNATURES_QUERY, { ref: node.id });
      return bindSignaturesToRevision(r?.node, node.revision);
    } catch (e) {
      console.warn('[node-detail] signature status failed:', e);
      return { ok: false } as const;
    }
  })();
  // portal#1014: the node's discussion (hadron-server#1606), streamed like the
  // reads above. The summary is its own read: the header's open-feedback cue
  // (hrn:node:hadronmemory.com:specs:cor:dmo:110:07) must not wait on, or fail with, the threads.
  // A comment is never a target (hrn:node:hadronmemory.com:specs:cor:dmo:110:00), so its own page reads none.
  const discussion: Promise<Discussion | null> = isComment
    ? Promise.resolve(null)
    : loadDiscussion(gqlClient(locals.token), node.id, {
        userId: locals.user?.id,
        memoryUrn: node.memory?.urn,
        impersonating: locals.impersonation != null,
      });
  const commentSummary: Promise<CommentSummary | null> = isComment ? Promise.resolve(null) : loadCommentSummary(gqlClient(locals.token), node.id);
  const revisionProvenance = (async (): Promise<ProvenanceResult<NodeProvenance[]>> => {
    if (isComment) return { ok: true, value: [] };
    try {
      const r = await gqlClient(locals.token).request<{ nodeRevisions: NodeProvenance[] }>(
        NODE_REVISIONS_PROVENANCE_QUERY,
        { nodeRef: node.id, limit: REVISIONS_LIMIT },
      );
      return { ok: true, value: r?.nodeRevisions ?? [] };
    } catch (e) {
      console.warn('[node-detail] revision provenance failed:', e);
      return { ok: false };
    }
  })();

  // A chat node (`nodeType: 'chat'`, or the legacy `team-chat` tag) is readable
  // two ways: as a node (the usual tabs) and as a chat thread. The Chat tab
  // renders the same bubbles as the standalone /chat view, so it is the node's
  // default tab and is AWAITED rather than streamed — it is the primary content
  // for those nodes. Every other node pays nothing. Best-effort: an empty thread
  // beats failing the whole page.
  // #926: a `team-chat`-tagged node is a chat only with a legacy thread under
  // it. Probed only for such a node, so every other page pays nothing.
  const chatEvidence = await legacyThreadEvidence(gqlClient(locals.token), node);
  const isChat = isChatNode(node, chatEvidence);
  // Whether the composer has anywhere to send. Derived from the NODE (the same
  // input the action re-derives it from), not from the parent layout's memory —
  // a partial/streamed layout must not be able to hide a composer the action
  // would happily accept, or offer one it would reject.
  const chatTarget = chatPostTarget(node, chatEvidence);
  const canPostChat = chatTarget.kind !== 'none';
  // portal#1525: is this the App's team CHANNEL? The entry button branches on
  // it (icon-only full-screen entry vs the text button every other chat
  // keeps), on the same predicate the composer trusts — the entry can never
  // disagree with where a post would land.
  const isTeamChannel = isTeamChannelChat(node, chatEvidence);
  // #793: a bounded WINDOW (the newest CHAT_PAGE_SIZE), not the whole thread.
  // The page also carries `hasOlder` so the Chat tab can offer scrollback
  // instead of silently presenting a window as the complete transcript.
  const chatMessagesPromise: Promise<ChatPage | null> = isChat
    ? loadChatMessages(gqlClient(locals.token), params.id, node.loc, { sort: chatSortKey(node), messageNodeTypes: chatMessageNodeTypes(node) }).catch((e) => {
        console.warn('[node-detail] chat messages failed:', e);
        return { messages: [], total: 0, hasOlder: false, offset: 0 };
      })
    : Promise.resolve(null);

  // #725/#726: the other end of a chat. A MESSAGE is marked in the header the
  // way a chat root is, and offers "Open chat" — the thread it belongs to is
  // the context a single bubble is missing, and nothing else on this page
  // links to it.
  const isChatMessage = isChatMessageNode(node);
  // The chat ROOT's node id, resolved from the ancestor lookup the breadcrumb
  // already made (the root is one of the message's ancestors), so this costs
  // no extra round trip. Two things are
  // deliberately checked rather than assumed:
  //   - the ancestor must actually BE a chat. A `<x>:messages:<y>` address does
  //     not make `<x>` a chat node, and an "Open chat" landing on an ordinary
  //     node would be a link that lies about where it goes.
  //   - `memoryId === params.id`, the same scoping the breadcrumb applies (#234)
  //     — a loc is unique per memory, not globally.
  // When the ancestor lookup FAILED, the root cannot be resolved and the action
  // is not offered. That withholds an affordance rather than asserting the
  // message has no chat, and it is the same degradation the breadcrumb already
  // accepts on the same input.
  const chatRootLoc = isChatMessage ? chatRootLocForMessage(node.loc) : null;
  const chatRoot = chatRootLoc ? ancestorByLoc.get(chatRootLoc) : undefined;
  // A legacy `message` under the root IS the root's thread evidence (#926).
  const openChat = chatRoot && isChatNode(chatRoot, { legacyThread: node.nodeType === 'message' })
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
  const [moveForm, testFlowForm, deleteForm, createParentForm, updateMetaForm, duplicateForm, convertToTaskForm, flowForm, edgesForm, sendChatMessageForm, approveForm, verifyForm] = await Promise.all([
    superValidate<NodeMoveForm>({ target: '' }, nodeMoveFormAdapter, { errors: false }),
    superValidate<NodeTestFlowForm>(
      { appId: '', orgId: org?.id ?? '', agentRef: '', payload: '' },
      nodeTestFlowFormAdapter,
      { errors: false },
    ),
    superValidate<NodeDeleteForm>({ hard: false }, nodeDeleteFormAdapter, { errors: false }),
    superValidate<NodeCreateParentForm>({ loc: '', name: '' }, nodeCreateParentFormAdapter, { errors: false }),
    superValidate<NodeUpdateMetaForm>(nodeMetaSeed(node), nodeUpdateMetaFormAdapter, { errors: false }),
    superValidate<NodeDuplicateForm>({}, nodeDuplicateFormAdapter, { errors: false, id: DUPLICATE_FORM_ID }),
    superValidate<NodeConvertToTaskForm>({}, nodeConvertToTaskFormAdapter, { errors: false, id: CONVERT_TO_TASK_FORM_ID }),
    superValidate<NodeUpdateFlowForm>({
      extractionRows: JSON.stringify(flowRows),
      outputWriteTo: output?.writeTo ?? '',
      outputMode: output?.mode ?? 'replace',
    }, nodeUpdateFlowFormAdapter, { errors: false }),
    superValidate<NodeUpdateEdgesForm>({
      edges: JSON.stringify(outgoingEdges),
    }, nodeUpdateEdgesFormAdapter, { errors: false }),
    // #1522: node-scoped id (`bootStart:<agentId>` pattern) — the same schema
    // also backs the standalone /chat page's composer, and both surfaces
    // defaulting to the shape hash made the two ChatThreads share one Superforms
    // id (duplicate-id warning, shared action data). Scoped to the node so a
    // late result from ANOTHER node's composer can never be consumed by this
    // one either; ChatThread is keyed by it and seeds only on an id match (see
    // hrn:node:hadronmemory.com:hadron-portal:findings:superforms-teardown-clears-result-guards). The id helper is
    // shared with the action — the two MUST agree, or results stop reaching
    // the form with no error.
    superValidate<SendChatMessageForm>({}, sendChatMessageFormAdapter, { errors: false, id: sendChatMessageFormId(params.nodeId) }),
    superValidate<NodeApproveForm>({ revision: node.revision }, nodeApproveFormAdapter, { errors: false, id: APPROVE_FORM_ID }),
    superValidate<NodeVerifyForm>({}, nodeVerifyFormAdapter, { errors: false, id: VERIFY_FORM_ID }),
  ]);

  // #1031: the Properties tab's storage form (once the `/edit` page). The
  // skill check is the server's lint verdict on the STORED export, per declared
  // host; it never throws, and costs nothing for a node with no export.
  const [storageForm, skillCheck] = await Promise.all([
    nodeStorageSeed(node),
    loadSkillCheck(gqlClient(locals.token), node),
  ]);

  const wikilinks = await wikilinksPromise;
  // #1161: marks edges whose far endpoint the server reports deleted. Reads only
  // when an endpoint is missing at all, and a missing endpoint the server does
  // not report stays masked (it may be an unreadable memory, not a deletion).
  const deletedEdges = await deletedEdgeEndpoints(
    gqlClient(locals.token), node.memoryId, [...(node.outgoingEdges ?? []), ...(node.incomingEdges ?? [])],
  );
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
    // portal#1525: the header's full-screen entry branch. See `chatTarget`.
    isTeamChannel,
    sendChatMessageForm,
    // `?tab=` deep-links a specific tab (the page falls back to its own default
    // for an unknown value). Used by the full-screen chat's way back — "View
    // node details" on agent/other chats (which must land on Content), the
    // Collapse button on a team Channel (which lands on Chat) — a chat node
    // opens on Chat otherwise.
    initialTab: url.searchParams.get('tab'),
    breadcrumb,
    wikilinks,
    deletedEdges,
    testFlowApps,
    memories,
    revisions,
    edgeRemovals,
    provenance,
    revisionProvenance,
    approval,
    signatures,
    signingOffered,
    mint,
    discussion,
    commentSummary,
    approveForm,
    verifyForm,
    moveForm,
    testFlowForm,
    deleteForm,
    createParentForm,
    updateMetaForm,
    duplicateForm,
    convertToTaskForm,
    flowForm,
    edgesForm,
    storageForm,
    skillCheck,
    runnableBlockedBy: runnableBlockedBy(node),
    noWriteDoor: noWriteDoor(node),
    // portal#1524: what the page may and may not say about this node's
    // neighbours now that the layout carries no node list. `ancestorsKnown`
    // false means a crumb without a node id is "not looked up", so the page
    // must not offer to create it (portal#1433: true once the bounded ancestor
    // read answered for every segment); `children` is the first page of direct
    // children (portal#1656), `childrenHasMore` whether more exist, or null with
    // `childrenUnavailable` when the read failed.
    ancestorsKnown,
    ...(await loadChildren(gqlClient(locals.token), params.id, node.loc)),
  };
};

// portal#1656: the first page of direct children, read with `childrenOf`
// ($lib/server/node-children). The rest come from ./children/+server.ts when
// the user asks. `children` is null only when the read failed: a large subtree
// no longer withholds the section, and a full page says more exist rather than
// passing for the whole list.
async function loadChildren(
  client: ReturnType<typeof gqlClient>,
  memoryId: string,
  loc: string,
): Promise<{ children: ChildRow[] | null; childrenHasMore: boolean; childrenUnavailable: boolean }> {
  try {
    const page = await readChildrenPage(client, memoryId, loc, 0);
    return { children: page.children, childrenHasMore: page.hasMore, childrenUnavailable: false };
  } catch (err) {
    console.warn('[node-detail] children read failed:', err);
    return { children: null, childrenHasMore: false, childrenUnavailable: true };
  }
}

/** portal#1899: the only error-code text a save log may carry: a bounded wire code, else a fixed marker. */
function boundedLogCode(code: string | null): string {
  if (!code) return 'no-code';
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'unrecognized';
}
/** User-facing text for a failed save read/write. A plain (non-GraphQL) Error's message is never shown: it can carry anything. */
function saveFailureDetail(e: unknown, fallback: string): string {
  return classifyGqlError(e).kind === 'transport' ? fallback : nodeWriteErrorText(e, fallback, NODE_WRITE_REFUSALS);
}

/**
 * #927 — the inline Content and Abstract saves.
 *
 * The editor posts the `Node.revision` it opened on, and the write sends it as
 * `expectedRevision` (hadron-server#937): the server refuses the proposed edit
 * with NODE_WRITE_CONFLICT when anything wrote the node since. Raw-drift
 * reconciliation can itself advance the stored revision while refusing the edit
 * (hadron-server#1458). Before this the whole editor buffer went out
 * unconditioned, and a stale one silently replaced newer content (seen in
 * production, a user editing alongside an agent).
 *
 * A save without a revision is refused rather than sent unguarded: an action
 * that cannot tell whether it overwrites someone does not guess (the same rule
 * as the Data and Properties `baseline`).
 *
 * Failures are CODES under `<field>Failed`, which the page localizes; the old
 * version returned prose the page never showed.
 */
const NODE_WRITE_REFUSALS = ['BAD_USER_INPUT', 'NODE_WRITE_CONFLICT', 'ROLE_GOVERNED', 'NODE_ALREADY_EXISTS', 'CONFLICT', 'SESSION_EXPIRED', 'FORBIDDEN'] as const;

async function saveNodeText(
  field: 'content' | 'abstract',
  value: string,
  rawRevision: FormDataEntryValue | null,
  nodeRef: string,
  token: string | null | undefined,
) {
  const failed = `${field}Failed` as const;
  const expectedRevision = parseExpectedRevision(rawRevision);
  if (expectedRevision === null) return fail(400, { [failed]: { code: 'no-baseline', detail: null } });

  const client = gqlClient(token);
  let node: MemoryNode | null;
  try {
    ({ node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: nodeRef }));
  } catch (e: unknown) {
    console.error('[node-detail] save failed:', { op: `update-${field}`, stage: 'read', code: boundedLogCode(extractGqlErrorCode(e)) });
    return fail(500, { [failed]: { code: 'failed', detail: saveFailureDetail(e, 'Failed to read the node') } });
  }
  if (!node) return fail(404, { [failed]: { code: 'not-found', detail: null } });

  // portal#1175: a comment's text is edited through `editComment`, with the
  // comment's own write counter as the precondition. The generic node write is
  // refused for a comment (hrn:node:hadronmemory.com:specs:cor:dmo:110:04), so
  // never fall through to it. Without the comment's details there is no safe
  // way to write: refuse rather than guess.
  if (node.nodeType === COMMENT_NODE_TYPE) {
    if (field !== 'content' || !node.asComment) return fail(403, { [failed]: { code: 'failed', detail: null } });
    const sent = await sendCommentWrite(client, node.id, {
      op: 'edit', commentId: node.asComment.id, body: value, expectedRevision,
    });
    if (sent.ok) return { [`${field}Saved`]: true };
    if (sent.code === 'NODE_WRITE_CONFLICT') return fail(409, { [failed]: { code: 'changed', detail: null } });
    return fail(sent.status, { [failed]: { code: 'failed', detail: sent.text } });
  }

  // #868: this edit touches neither governance signal, so the resulting kind
  // is the node's CURRENT one — which is why the fetched node, not the input,
  // decides the door.
  const input = {
    // #237: memoryId from the node, not the URL. Selects the target together
    // with loc; omitted fields (name, description, …) are preserved.
    memoryId: node.memoryId,
    loc: node.loc,
    expectedRevision,
    // #235 history: the old upsertNode resolver cleared omitted tags
    // (`input.tags ?? []`). updateNode preserves omitted tags, so this explicit
    // pass-through is no longer load-bearing — but it is still correct (it
    // round-trips the user's tags verbatim), so it stays. The `?? []` guards a
    // null-tags schema-shape regression at runtime. It is read here, after the
    // editor opened, but the revision check covers it: if the tags changed
    // since, so did the revision, and the write is refused.
    tags: node.tags ?? [],
    [field]: value,
  };
  try {
    await client.request(nodeUpdateDocument(node, input), { input });
  } catch (e: unknown) {
    if (e instanceof NoNodeDoorError) return fail(409, { [failed]: { code: 'no-door', detail: e.message } });
    // The server's words are kept: NODE_WRITE_CONFLICT is not only a revision
    // mismatch (a concurrent move answers with it too), so the page words the
    // conflict generically unless the reload shows THIS field moved.
    if (extractGqlErrorCode(e) === 'NODE_WRITE_CONFLICT') {
      return fail(409, { [failed]: { code: 'changed', detail: nodeWriteErrorText(e, '', NODE_WRITE_REFUSALS) || null } });
    }
    // portal#1142 P0a: an include refusal (hadron-server#2040) wrote nothing;
    // say so with the server's words, the tag and the next step.
    const include = includeRefusalOf(e);
    if (include) return fail(400, { [failed]: { code: 'include', detail: includeRefusalText(include) } });
    const detail = saveFailureDetail(e, 'Save failed');
    // portal#1899: the server's typed boot-prompt refusals (a compiled prompt is written only by a
    // compile; a worker session never edits a boot prompt) wrote nothing and are the user's to act on,
    // so they are a typed 4xx rejection, not an internal failure. The wire text is never forwarded:
    // the page words each fixed code itself (localized).
    const code = extractGqlErrorCode(e);
    if (code === 'BOOT_PROMPT_COMPILED_WRITE') return fail(400, { [failed]: { code: 'compiled-prompt', detail: null } });
    if (code === 'BOOT_PROMPT_WORKER_SESSION_REFUSED') return fail(400, { [failed]: { code: 'boot-prompt-governed', detail: null } });
    if (code === 'BAD_USER_INPUT') return fail(400, { [failed]: { code: 'rejected', detail } });
    // The unclassified path keeps a bounded log: operation, stage and error code only, never the wire text, variables or content.
    console.error('[node-detail] save failed:', { op: `update-${field}`, stage: 'write', code: boundedLogCode(code) });
    return fail(500, { [failed]: { code: 'failed', detail } });
  }
  return { [`${field}Saved`]: true };
}


/**
 * A node address with its prefix and grammar normalized, so two spellings of
 * the same node compare equal: the `hrn:node:` / `urn:node:` prefix may be
 * absent, and a URN from an older screen may be v1 (`::`) where composeNodeUrn
 * emits v2 (single colon, hrn:node:hadronmemory.com:specs:cor:urn:010:01).
 */
function bareNodeAddress(u: string): string {
  return u.replace(/^(?:hrn|urn):node:/, '').split('::').join(':');
}

/**
 * Whether a pasted destination is, spelling aside, the node's own address.
 * Only the `hrn:`/`urn:` prefix is ignored: the grammar is NOT normalized,
 * because a legacy ownership chain (`org::app::agent::system::loc`) has no
 * string-derivable v2 form and may name another memory through the server's
 * alias map. Anything but the same string is forwarded for the server to
 * resolve (#1879 local review).
 */
function isSameNodeAddress(a: string, b: string): boolean {
  const strip = (u: string) => u.trim().replace(/^(?:hrn|urn):node:/, '');
  return strip(a) === strip(b);
}

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
  // #1031: the Properties tab's storage form — see storage-action.ts.
  updateStorage,

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
      return message(form, { type: 'error', text: nodeWriteErrorText(e, 'Failed to create parent node', NODE_WRITE_REFUSALS) }, { status: 500 });
    }
  },

  updateMeta: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const form = await superValidate<NodeUpdateMetaForm>(fd, nodeUpdateMetaFormAdapter);
    // portal#2023: the baseline the editor opened on. Every refusal that wrote nothing echoes it back
    // beside the form: a full-page response (no JS, or a remount) restores the kept draft from the
    // form, and the draft must keep the baseline it was typed against, or a retry would compare it
    // with the fresh node and write it over the other editor's change. A failure AFTER the update
    // committed does not echo it: the page advances the name itself (see onResult).
    const baselineName = fd.get('baselineName');
    const baselineLoc = fd.get('baselineLoc');
    const metaBaseline = typeof baselineName === 'string' && typeof baselineLoc === 'string'
      ? { metaBaseline: { name: baselineName, loc: baselineLoc } } : {};
    const refuse = (status: number, text: string) => {
      message(form, { type: 'error', text });
      return fail(status, { form, ...metaBaseline });
    };
    if (!form.valid) return fail(400, { form, ...metaBaseline });
    const client = gqlClient(locals.token);

    const { node: currentNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { ref: params.nodeId },
    );
    if (!currentNode) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });

    // portal#2023: the editor keeps an unsaved draft across a loader refresh, so
    // the draft can be older than the node. This save writes name whole and
    // moves the node whenever `loc` differs from the node's CURRENT loc, so an
    // older draft would overwrite another editor's name and move a node they
    // had moved back. The form therefore carries the name and loc it was
    // seeded from, like the Data and Properties editors carry `baseline`: a
    // mismatch with the node as read just now refuses before any write, with
    // no update and no moveNode. A missing baseline is refused too, never
    // treated as "no conflict".
    if (typeof baselineName !== 'string' || typeof baselineLoc !== 'string') {
      return refuse(400, t('node.meta.no-baseline', 'This editor is out of date, so nothing was saved. Reload the page and try again.'));
    }
    if (baselineName !== (currentNode.name ?? '') || baselineLoc !== currentNode.loc) {
      return refuse(409, t('node.meta.conflict', 'This node was changed (its name or location) since you opened the editor, so nothing was saved. Cancel to load the current values, then make your edit again.'));
    }

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

    // #868: updateMeta is the ONE action here that can change a governance
    // signal, so its resulting kind is the SUBMITTED `isRunnable` merged over
    // the node. Un-ticking Runnable on a task node is still a TASK-door write
    // (before ∪ after), a direction #867's submitted-value-only routing got
    // wrong.
    //
    // #921: role rides along only when the user changed it (`roleUpdate`):
    // omitted, the server preserves it; emptied, it is cleared. The door below
    // is chosen on BEFORE ∪ AFTER with it included, so a role edit on a
    // governed node goes through that kind's door, and the server's own gate
    // decides whether the transition is allowed.
    //
    // ORDER (@copilot on #869, @codex on #929): the fallible metadata update
    // runs FIRST, selected by the node's id, and the move only after it
    // succeeded. The chooser can refuse (a doorless combination) and so can
    // the server (a governed role transition it does not allow); either one
    // after a committed move left the node relocated with none of the edit
    // applied. Now a refusal leaves the node exactly where and as it was.
    const role = roleUpdate(form.data.role, form.data.roleSeed);
    const input = {
      id: currentNode.id, name, nodeType, description, alias,
      seq: Number.isNaN(seq) ? null : seq, tags, isRunnable,
      ...(role !== undefined ? { role } : {}),
    };
    try {
      assertNodeUpdateDoor(currentNode, input);
    } catch (e: unknown) {
      return refuse(500, nodeWriteErrorText(e, 'Failed to save', NODE_WRITE_REFUSALS));
    }

    try {
      await client.request(nodeUpdateDocument(currentNode, input), { input });
    } catch (e: unknown) {
      return refuse(500, nodeWriteErrorText(e, 'Failed to save', NODE_WRITE_REFUSALS));
    }

    // Move if loc changed. #237: route the move through the node's OWN
    // identity (#564: sourceRef = the PK, targetUrn = the full destination
    // node URN composed from the node's own memory urn), so a stale URL can't
    // redirect it. An occupied destination fails loudly with
    // NODE_ALREADY_EXISTS (#501). The other edits are already SAVED by then,
    // so a failed move says so rather than implying nothing happened.
    //
    // #1876: a pasted FULL node URN is the destination as written (same
    // detection as the Move dialog): another memory moves across, this memory
    // renames in place, the node's own address is no change. It is never
    // composed as a loc beneath the source memory. A bare loc composes as before.
    const locIsFullUrn = isFullyQualifiedNodeUrnInput(newLoc);
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;
    const unchanged =
      loc === currentNode.loc ||
      (locIsFullUrn &&
        !!currentNode.memory?.urn &&
        isSameNodeAddress(loc, composeNodeUrn(currentNode.memory.urn, currentNode.loc)));
    if (!unchanged) {
      // `metaSaved` on every failure below: the edits ARE saved, and a failed
      // action does not rerun the page load, so the client reloads the node
      // itself on this flag rather than keep showing the pre-save metadata
      // (@codex on #929).
      if (!currentNode.memory?.urn) {
        message(form, { type: 'error', text: t('node.meta.saved-not-moved', 'Saved, but the node was not moved: {detail}', { detail: 'it has no memory URN to move by.' }) });
        return fail(500, { form, metaSaved: true });
      }
      try {
        await client.request(MOVE_NODE_MUTATION, {
          sourceRef: currentNode.id,
          targetUrn: locIsFullUrn ? loc : composeNodeUrn(currentNode.memory.urn, loc),
        });
      } catch (e: unknown) {
        // An occupied destination is a 409 Conflict, not a 500 — matches the
        // /api/nodes/move endpoint and keeps it out of error monitoring.
        const status = extractGqlErrorCode(e) === 'NODE_ALREADY_EXISTS' ? 409 : 500;
        const detail = nodeWriteErrorText(e, 'Failed to move node', NODE_WRITE_REFUSALS);
        // #1989: say what is true now: the edits are saved, nothing moved, and
        // the node is still at its old address (a refused move writes nothing,
        // hrn:node:hadronmemory.com:specs:cor:api:190:01). The page keeps this
        // text and the typed loc across its reload, so the refusal is not
        // reverted out from under the user.
        const text = t('node.meta.saved-not-moved-at', 'Saved, but the node was not moved: {detail}. It is still at {urn}.', {
          detail: detail.replace(/[.\s]+$/, ''), urn: composeNodeUrn(currentNode.memory.urn, currentNode.loc),
        });
        if (status === 409) setError(form, 'loc', text);
        else message(form, { type: 'error', text });
        return fail(status, { form, metaSaved: true });
      }
    }

    return message(form, { type: 'success', text: t('node.meta.saved', 'Node settings saved.') });
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
      // `recursive` (#621) is only ever true after the dialog below offered
      // the subtree choice, which itself only appears after a refusal.
      await gqlClient(locals.token).request(DELETE_NODE_MUTATION, { nodeRef: node.id, hard, recursive: form.data.recursive });
    } catch (e: unknown) {
      // A parent node's delete is refused with NODE_HAS_DESCENDANTS (#621):
      // the server names the count and points at recursive — CLI jargon the
      // portal user cannot act on. Map it to a 409 whose message says which
      // checkbox deletes the subtree, and carry the count on the action
      // result so the dialog renders that checkbox even when the page's
      // graph payload undercounted the subtree.
      if (extractGqlErrorCode(e) === 'NODE_HAS_DESCENDANTS') {
        const count = Number(extractGqlErrorExtensions(e)?.count ?? 0);
        message(form, {
          type: 'error',
          text: t('node-actions.delete.has-descendants',
            'This node has {count} descendant node(s). To delete the whole subtree, check "Also delete its descendants" and confirm.',
            { count }),
        });
        return fail(409, { form, deleteRefusedDescendants: count });
      }
      return message(form, { type: 'error', text: nodeWriteErrorText(e, 'Failed to delete', NODE_WRITE_REFUSALS) }, { status: 500 });
    }
    // Redirect to the *actual* memory's list — not the URL's gid, which
    // may have been stale.
    redirect(303, `/app/memories/${node.memoryId}/nodes`);
  },

  // Chat tab composer. Mirrors the standalone /chat page's `sendMessage`
  // (same schema, same `_kind`) and goes through the same team-chat module, so
  // a message sent from either surface lands identically.
  sendChatMessage: async ({ request, params, locals }) => {
    // Same node-scoped id as the load above (#1522): the result — enhanced,
    // no-JS, or a late answer — comes back under the id this node's live form
    // holds, and no other form's.
    const form = await superValidate<SendChatMessageForm>(await request.formData(), sendChatMessageFormAdapter, {
      id: sendChatMessageFormId(params.nodeId),
    });
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { ref: params.nodeId });
      if (!node) return message(form, { type: 'error', text: 'Chat node not found' }, { status: 404 });
      const evidence = await legacyThreadEvidence(client, node);
      if (!isChatNode(node, evidence)) {
        return message(form, { type: 'error', text: 'This node is not a chat.' }, { status: 400 });
      }
      if (!locals.user) return message(form, { type: 'error', text: 'Not authenticated' }, { status: 401 });

      // #237: the target is derived from the fetched node, not the URL, which
      // may be stale. `none` means the message would land in some OTHER thread
      // (or nowhere) — refuse rather than report a success that isn't one.
      const target = chatPostTarget(node, evidence);
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
        { type: 'error', text: nodeWriteErrorText(e, 'Failed to send message', NODE_WRITE_REFUSALS) },
        { status: 500 },
      );
    }
  },

  // #927: both inline text editors save through `saveNodeText`, which carries
  // the revision the editor opened on. See there.
  updateContent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    return saveNodeText('content', String(fd.get('content') ?? ''), fd.get('expectedRevision'), params.nodeId, locals.token);
  },

  updateAbstract: async ({ request, params, locals }) => {
    const fd = await request.formData();
    // Send the raw string; the server normalizes empty/whitespace-only to
    // null (spec 031) and recomputes abstractOriginHash from current
    // content (spec 032). Length cap (2000) is enforced server-side too,
    // with a client-side maxlength as the first line of defense.
    return saveNodeText('abstract', String(fd.get('abstract') ?? ''), fd.get('expectedRevision'), params.nodeId, locals.token);
  },

  /**
   * #894 — the Data tab's Source view saves the WHOLE `data` value (any JSON
   * except a top-level `null`: the column is a Prisma `Json?` this surface
   * cannot write a bare null into, so clearing is not offered here).
   *
   * The same contract as updateProperties (#886), for the same reasons:
   * - validated by the shared checker (UTF-8 byte cap, depth, exact numbers,
   *   duplicate keys) BEFORE any GraphQL call;
   * - the form posts a fingerprint of the value it was OPENED with, and a save
   *   is refused when the stored value no longer matches — a Source view left
   *   open must not undo a Flow-tab edit (`updateFlow` merges into `data`) or
   *   a CLI write made since;
   * - failures are CODES the page localizes, plus the server's own words; the
   *   old version returned prose the page then dropped into console.error.
   */
  updateData: async ({ request, params, locals }) => {
    // Actions do not run the /app layout's sign-in redirect.
    if (!locals.token) return fail(401, { dataFailed: { code: 'unauthenticated', detail: null } });
    const fd = await request.formData();
    const parsed = parseDataSource(String(fd.get('data') ?? ''));
    if (!parsed.ok) return fail(400, { dataFailed: { code: parsed.code, detail: parsed.detail ?? null } });
    const baseline = fd.get('baseline');
    if (!isFingerprint(baseline)) {
      return fail(400, { dataFailed: { code: 'no-baseline', detail: null } });
    }

    const client = gqlClient(locals.token);
    let node: MemoryNode | null;
    try {
      ({ node } = await client.request<{ node: MemoryNode | null }>(NODE_DATA_READ_QUERY, { ref: params.nodeId }));
    } catch (e: unknown) {
      return fail(500, { dataFailed: { code: 'failed', detail: nodeWriteErrorText(e, 'Failed to read the node', NODE_WRITE_REFUSALS) } });
    }
    if (!node) return fail(404, { dataFailed: { code: 'not-found', detail: null } });

    // Strict about null (@codex on #896): `{}` written over absent data by
    // another editor must read as a change here, as it does in the no-op check.
    if ((await jsonFingerprint(node.data, { nullIsEmpty: false })) !== baseline) {
      return fail(409, { dataFailed: { code: 'changed', detail: null } });
    }
    // A no-op writes nothing. Compared by value, key order aside, and WITHOUT
    // the null ≡ {} leniency of the stale check: `{}` over no data is a change.
    if (canonicalJson(node.data ?? null) === canonicalJson(parsed.value)) return { dataSaved: true };

    // #868: neither governance signal is touched — the door follows the
    // node's current kind. #237: memoryId from the node, not the URL. #235:
    // explicit tags pass-through, kept deliberately.
    const input = { memoryId: node.memoryId, loc: node.loc, tags: node.tags ?? [], data: parsed.value };
    try {
      assertNodeUpdateDoor(node, input);
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      if (e instanceof NoNodeDoorError) return fail(409, { dataFailed: { code: 'no-door', detail: e.message } });
      const detail = nodeWriteErrorText(e, 'Failed to save', NODE_WRITE_REFUSALS);
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') return fail(400, { dataFailed: { code: 'rejected', detail } });
      return fail(500, { dataFailed: { code: 'failed', detail } });
    }
    return { dataSaved: true };
  },

  /**
   * #886 — the Properties tab's Source view: the WHOLE `properties` bag as
   * JSON, on any node (typed collections included, where the typed editor can
   * only delete an undeclared key such as `exports`).
   *
   * Replaces the bag whole — `updateTaskNode`/`updateNode` are the only doors a
   * runnable node has, and #1227's atomic merge is refused on it
   * (hrn:node:hadronmemory.com:hadron-portal:findings:atomic-exports-merge-refused-on-task-nodes).
   * So the form also posts a fingerprint of the bag it was OPENED with
   * (`baseline`), and a save is refused when the stored bag no longer matches: a Source view left open
   * while someone ticked a skill-export box, or ran the CLI, must not silently
   * put back what they changed. It narrows the race to the read-to-write
   * window; closing that is server#1291.
   *
   * Failures are CODES (the page localizes them) plus the server's own words
   * where it gave some — a strict collection's refusal must reach the user
   * verbatim.
   */
  updateProperties: async ({ request, params, locals }) => {
    // Actions do not run the /app layout's sign-in redirect.
    if (!locals.token) return fail(401, { propertiesFailed: { code: 'unauthenticated', detail: null } });
    const fd = await request.formData();
    const parsed = parsePropertiesSource(String(fd.get('properties') ?? ''));
    if (!parsed.ok) return fail(400, { propertiesFailed: { code: parsed.code, detail: parsed.detail ?? null } });

    // The FINGERPRINT of the bag the editor opened on, not a second copy of it:
    // two copies of a bag at the cap overran the body limit (@codex on #893).
    const baseline = fd.get('baseline');
    if (!isFingerprint(baseline)) {
      // Without it the stale check cannot run, and a save that cannot tell
      // whether it overwrites someone is refused rather than guessed.
      return fail(400, { propertiesFailed: { code: 'no-baseline', detail: null } });
    }

    const client = gqlClient(locals.token);
    let node: MemoryNode | null;
    try {
      ({ node } = await client.request<{ node: MemoryNode | null }>(NODE_PROPERTIES_READ_QUERY, { ref: params.nodeId }));
    } catch (e: unknown) {
      return fail(500, { propertiesFailed: { code: 'failed', detail: nodeWriteErrorText(e, 'Failed to read the node', NODE_WRITE_REFUSALS) } });
    }
    if (!node) return fail(404, { propertiesFailed: { code: 'not-found', detail: null } });

    if ((await propertiesFingerprint(node.properties)) !== baseline) {
      return fail(409, { propertiesFailed: { code: 'changed', detail: null } });
    }
    if (sameProperties(node.properties, parsed.value)) return { propertiesSaved: true };

    // ONLY properties: an omitted field is preserved, and no governance signal
    // is touched, so the door is the node's current kind (#868).
    const input = { memoryId: node.memoryId, loc: node.loc, properties: parsed.value };
    try {
      assertNodeUpdateDoor(node, input);
      await client.request(nodeUpdateDocument(node, input), { input });
    } catch (e: unknown) {
      if (e instanceof NoNodeDoorError) {
        return fail(409, { propertiesFailed: { code: 'no-door', detail: e.message } });
      }
      const detail = nodeWriteErrorText(e, 'Failed to save', NODE_WRITE_REFUSALS);
      // #588: a memory-schema verdict (strict collection, wrong type, missing
      // required field) — the server's words, verbatim.
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
        return fail(400, { propertiesFailed: { code: 'rejected', detail } });
      }
      return fail(500, { propertiesFailed: { code: 'failed', detail } });
    }
    return { propertiesSaved: true };
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
      return message(form, { type: 'error', text: nodeWriteErrorText(e, 'Save failed', NODE_WRITE_REFUSALS) }, { status: 500 });
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
        ...(form.data.agentRef ? { agentRef: form.data.agentRef } : {}),
      });
      runId = res.runTask;
    } catch (e: unknown) {
      return message(form, { type: 'error', text: runStartError(e, 'Failed to start the run', NODE_WRITE_REFUSALS) }, { status: runStartStatus(e) });
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
      { id: DUPLICATE_FORM_ID },
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
          return message(form, { type: 'error', text: nodeWriteErrorText(e, 'Failed to duplicate node', NODE_WRITE_REFUSALS) }, { status: 500 });
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
    if (bareNodeAddress(targetUrn) === bareNodeAddress(composeNodeUrn(node.memory.urn, node.loc))) {
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
      // portal#1014: a node with live discussions can't move into a memory
      // that takes no comments (hrn:node:hadronmemory.com:specs:cor:dmo:110:02). Fixed copy names
      // the remedy, which is a memory admin's thread delete, not a retry.
      if (code === 'COMMENT_MOVE_UNCOMMENTABLE') {
        return setError(form, 'target', commentMoveRefusedText(), { status: 409 });
      }
      const error = nodeWriteErrorText(e, 'Failed to move node', NODE_WRITE_REFUSALS);
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
      { id: CONVERT_TO_TASK_FORM_ID },
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
      return message(form, { type: 'error', text: nodeWriteErrorText(e, 'Failed to convert node to a task', NODE_WRITE_REFUSALS) }, { status: 500 });
    }
  },

  // #992 (hadron-server#1591): approve the revision the reader saw. No
  // redirect; enhance re-runs load, so the badge shows the new approval.
  // Refusals map to fixed copy by code, never the server's prose.
  approveNode: async ({ request, params, locals }) => {
    const form = await superValidate<NodeApproveForm>(await request.formData(), nodeApproveFormAdapter, { id: APPROVE_FORM_ID });
    if (!form.valid) return fail(400, { form });
    try {
      const r = await gqlClient(locals.token).request<{ approveNode: { approval: { revision: number } | null } }>(
        APPROVE_NODE_MUTATION,
        { nodeRef: params.nodeId, revision: form.data.revision },
      );
      const rev = r.approveNode.approval?.revision ?? form.data.revision;
      return message(form, { type: 'success', text: t('node.approval.approved-now', 'Revision {rev} approved.', { rev }) });
    } catch (e: unknown) {
      const code = extractGqlErrorCode(e);
      return message(form, { type: 'error', text: approveRefusalText(code) }, { status: approvalRefusalStatus(code) });
    }
  },

  // #992: re-check the approved text against its recorded hash. A read, but
  // an explicit one: it reports a verdict the reader asked for, as a message.
  verifyNode: async ({ request, params, locals }) => {
    const form = await superValidate<NodeVerifyForm>(await request.formData(), nodeVerifyFormAdapter, { id: VERIFY_FORM_ID });
    if (!form.valid) return fail(400, { form });
    try {
      const r = await gqlClient(locals.token).request<{ verifyNode: NodeIntegrityCheck }>(
        VERIFY_NODE_QUERY,
        { nodeRef: params.nodeId },
      );
      const { state, expectedHash, actualHash } = r.verifyNode;
      const { text, problem } = integrityText(r.verifyNode);
      // The hashes ride along so a reader can copy them into a report or a
      // CLI check. Hex digests, not server prose.
      return {
        verifyIntegrity: { state, expectedHash: expectedHash ?? null, actualHash: actualHash ?? null },
        ...message(form, { type: problem ? 'error' : 'success', text }),
      };
    } catch (e: unknown) {
      const code = extractGqlErrorCode(e);
      return message(form, { type: 'error', text: verifyFailureText(code) }, { status: approvalRefusalStatus(code) });
    }
  },

  // portal#1022 links half — the portal's leg of
  // hrn:node:hadronmemory.com:specs:cor:dmo:130:08: create a
  // signing request and hand over the ceremony page's link. NOT the ceremony:
  // no assertion, no key material, nothing but the request and a redirect, so
  // the signer always proves who they are on the page that shows what is
  // signed. Plain form (no superforms): the only input is the revision the
  // reader saw, pinned like an approval so an edit in between answers
  // REVISION_MISMATCH instead of requesting a signature for text never
  // reviewed. `redirect()` throws, so the catch rethrows it — the hand-over
  // must never be swallowed into a refusal message.
  requestSignature: async ({ request, params, locals }) => {
    // A stale tab after signing out: the token is gone, and the capability
    // gate below would fold that into "not offered" — a wrong reason for a
    // reader whose actual problem is the dead session. Distinguish it first;
    // the other actions on this page surface their auth failures from the
    // server's UNAUTHENTICATED, and this one gets its own honest line.
    if (!locals.token) {
      return fail(400, {
        requestSignatureError: t('node.signatures.request.signed-out', 'Your session has ended. Sign in again, then request the signature from the node page.'),
      });
    }
    // The mutation exists in the SDL only while the deployment offers signing
    // (hadron-server#1895/#1918); asking first keeps a switched-off server
    // from answering every click with a validation error.
    if (!(await deploymentOffersSigning(locals.token))) {
      return fail(400, {
        requestSignatureError: t('node.signatures.request.not-offered', 'This deployment does not offer node signing.'),
      });
    }
    // Dorian's BLIND P2 on #1860: a missing or malformed revision must never
    // degrade to `undefined` — the server would then pin its CURRENT revision,
    // and the request could be for text the reader never saw. The page's other
    // revision-pinned writes agree: saveNodeText answers no-baseline, the
    // approve forms fail superforms validation. The portal always renders a
    // revision, so the only way here is a tampered or broken form — refuse it
    // and send nothing.
    const revision = parseExpectedRevision((await request.formData()).get('revision'));
    if (revision === null) {
      return fail(400, {
        requestSignatureError: t('node.signatures.request.stale-form', 'Reload the page — this form no longer matches the node on screen.'),
      });
    }
    let failure: string | null = null;
    try {
      const r = await gqlClient(locals.token).request<{ requestNodeSignature: { ceremonyUrl: string } }>(
        REQUEST_SIGNATURE_MUTATION,
        { nodeRef: params.nodeId, expectedRevision: revision },
      );
      // ceremonyUrl is String! on SigningRequest! — the contract guarantees a
      // URL, and any GraphQL-level failure threw into the catch below, so
      // there is no lying-server branch here to pin with an illegal fixture
      // (hrn:node:hadronmemory.com:hadron-portal:review:a-response-fixture-must-be-legal-under-the-schema).
      // The SDL says copy it verbatim, never compose it.
      redirect(303, r.requestNodeSignature.ceremonyUrl);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      // A typed refusal gets portal copy; anything else — an internal error,
      // an unknown code a newer server added, a transport failure — keeps the
      // generic line, never a borrowed reason (the gql-error convention).
      failure = signatureRequestRefusalText(extractGqlErrorCode(e))
        ?? extractGqlError(e, t('node.signatures.request.failed', 'Could not start a signing request.'), [], { transport: 'fallback' });
    }
    return fail(400, { requestSignatureError: failure });
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
      return message(form, { type: 'error', text: nodeWriteErrorText(e, 'Failed to update edges', NODE_WRITE_REFUSALS) }, { status: 500 });
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
      // #868: the door is chosen PER SIBLING, from the node being written —
      // never from `anchorNode`, which is not one of them. A reorder mixes
      // kinds routinely: one task node among ordinary siblings is the common
      // case, and it is the whole reason a reorder failed at all.
      //
      // TWO PASSES (@copilot on PR #869): every door is settled before the
      // first write, because the chooser can REFUSE and refusing on a later
      // sibling would leave the earlier ones reordered under a 500 that says
      // nothing about it. See /api/nodes/reorder for the full note, including
      // what this deliberately does NOT fix.
      const planned: { node: MemoryNode; input: Record<string, unknown> }[] = [];
      for (const u of updates) {
        // #335 (closes the #234 follow-up): scope the read to the anchor's
        // memory. Previously NODE_QUERY(loc:) was memory-blind, so a foreign
        // memory sharing the loc could win the resolver's first-match and feed
        // a wrong `name` into anchorNode.memoryId's row. Now it's pinned.
        const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { ref: u.loc, memoryRef: anchorNode.memoryId });
        if (!node) continue;
        const input = {
          memoryId: anchorNode.memoryId,
          loc: u.loc,
          // #235: explicit tags pass-through — no longer load-bearing
          // under updateNode, kept deliberately. See updateContent.
          tags: node.tags ?? [],
          seq: u.seq,
        };
        assertNodeUpdateDoor(node, input);
        planned.push({ node, input });
      }
      for (const { node, input } of planned) {
        // Chooser INLINE, preflight via assertNodeUpdateDoor above — hoisting
        // the document into `planned` makes this call opaque to
        // check-graphql-callers and its variables stop being checked. Measured
        // twice on this PR: the checked count drops by one per hoisted site.
        await client.request(nodeUpdateDocument(node, input), { input });
      }
    } catch (e: unknown) {
      return fail(500, { error: nodeWriteErrorText(e, 'Reorder failed', NODE_WRITE_REFUSALS) });
    }
  },
};
