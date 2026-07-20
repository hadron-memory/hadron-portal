import { fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { NODE_BY_ID_QUERY, NODE_QUERY, DELETE_NODE_MUTATION, CREATE_NODE_MUTATION, UPDATE_NODE_MUTATION, MOVE_NODE_MUTATION, CLONE_NODE_MUTATION, ORG_APP_INSTALLS_QUERY, RUN_TASK_APP_MUTATION, MEMORIES_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import { cleanLocInput } from '$lib/urn/clean-loc-input';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { isCanonicalNodeType } from '$lib/node-types';
import { outputFromNodeData, rowsFromNodeData, rowsToSpec } from '$lib/flow/extraction';
import { t } from '$lib/i18n/t';
import type { MemoryNode, NodeRevision } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  nodeDeleteSchema,
  nodeMoveSchema,
  nodeTestFlowSchema,
  nodeUpdateEdgesSchema,
  nodeUpdateFlowSchema,
  parseValidatedEdges,
  parseValidatedFlowRows,
} from './schema';

type NodeMoveForm = Infer<typeof nodeMoveSchema, 'zod4'>;
type NodeTestFlowForm = Infer<typeof nodeTestFlowSchema, 'zod4'>;
type NodeDeleteForm = Infer<typeof nodeDeleteSchema, 'zod4'>;
type NodeUpdateFlowForm = Infer<typeof nodeUpdateFlowSchema, 'zod4'>;
type NodeUpdateEdgesForm = Infer<typeof nodeUpdateEdgesSchema, 'zod4'>;

const nodeMoveFormAdapter = zod4(nodeMoveSchema);
const nodeTestFlowFormAdapter = zod4(nodeTestFlowSchema);
const nodeDeleteFormAdapter = zod4(nodeDeleteSchema);
const nodeUpdateFlowFormAdapter = zod4(nodeUpdateFlowSchema);
const nodeUpdateEdgesFormAdapter = zod4(nodeUpdateEdgesSchema);

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

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  // parent() and the node read are independent — fetch in parallel.
  // SvelteKit memoizes parent() across the load, so the guard's later call
  // does not refetch; passing a thunk that resolves to the already-fetched
  // value keeps the guard signature reusable without an extra round-trip.
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);
  if (!data.node) throw new Error(`Node not found: ${params.nodeId}`);
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
  if (node.memoryId !== params.id) {
    redirect(303, `/app/memories/${node.memoryId}/nodes/${params.nodeId}`);
  }

  // Build breadcrumb from loc segments — look up ancestor nodes within THIS
  // memory only. Resolving by loc alone (via NODE_QUERY) would cross-pollinate
  // with any other memory the caller can access that happens to share the loc,
  // producing breadcrumb links like memories/A/nodes/<B's PK>. See #234.
  const memoryNodes = parentData.graphNodes ?? [];
  const ancestorIdByLoc = new Map<string, string>();
  for (const n of memoryNodes) {
    if (n.memoryId === params.id) ancestorIdByLoc.set(n.loc, n.id);
  }

  const parts = node.loc.split(':');
  const breadcrumb: Array<{ label: string; path: string; nodeId: string | null }> = [];

  for (let i = 0; i < parts.length; i++) {
    const ancestorLoc = parts.slice(0, i + 1).join(':');
    let nodeId: string | null = null;
    if (i < parts.length - 1) {
      nodeId = ancestorIdByLoc.get(ancestorLoc) ?? null;
    }
    breadcrumb.push({ label: parts[i], path: ancestorLoc, nodeId });
  }

  // "Test flow" (#478 phase 3): a runnable node can be executed as a MANUAL
  // headless run via runTask(appRef:) — the button needs the org's Apps to
  // run as. Best-effort: only offered to org members (org present) on
  // runnable nodes; a fetch failure just hides the button (auxiliary UI,
  // not the page's core load — review:no-silent-loader-catch).
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

  const flowRows = rowsFromNodeData(node.data);
  const output = outputFromNodeData(node.data);
  const outgoingEdges = node.outgoingEdges.map((e) => ({ targetId: e.target.id, name: e.name ?? null }));
  const [moveForm, testFlowForm, deleteForm, flowForm, edgesForm] = await Promise.all([
    superValidate<NodeMoveForm>({ target: '' }, nodeMoveFormAdapter, { errors: false }),
    superValidate<NodeTestFlowForm>(
      { appId: '', orgId: org?.id ?? '', payload: '' },
      nodeTestFlowFormAdapter,
      { errors: false },
    ),
    superValidate<NodeDeleteForm>({ hard: false }, nodeDeleteFormAdapter, { errors: false }),
    superValidate<NodeUpdateFlowForm>({
      extractionRows: JSON.stringify(flowRows),
      outputWriteTo: output?.writeTo ?? '',
      outputMode: output?.mode ?? 'replace',
    }, nodeUpdateFlowFormAdapter, { errors: false }),
    superValidate<NodeUpdateEdgesForm>({
      edges: JSON.stringify(outgoingEdges),
    }, nodeUpdateEdgesFormAdapter, { errors: false }),
  ]);

  return { node, breadcrumb, testFlowApps, memories, revisions, moveForm, testFlowForm, deleteForm, flowForm, edgesForm };
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
    const fd = await request.formData();
    const loc = String(fd.get('loc') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    if (!loc || !name) return fail(400, { error: 'Missing loc or name' });
    const client = gqlClient(locals.token);
    // #237: derive memoryId from the anchor (URL) node so a stale URL
    // doesn't write the new parent into the wrong memory.
    const { node: anchorNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!anchorNode) return fail(404, { error: 'Node not found' });
    try {
      const res = await client.request<{ createNode: { id: string } }>(CREATE_NODE_MUTATION, {
        input: { memoryId: anchorNode.memoryId, loc, name, nodeType: 'info' },
      });
      return { createdParentId: res.createNode.id };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create parent node' });
    }
  },

  updateMeta: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);

    const { node: currentNode } = await client.request<{ node: MemoryNode | null }>(
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!currentNode) return fail(404, { error: 'Node not found' });

    const name = String(fd.get('name') ?? '').trim();
    // Accept only a canonical type or the node's existing one — otherwise keep
    // the current type. Guards against a crafted POST writing an arbitrary
    // nodeType (the dropdown only offers canonical values), and a blank field
    // never clears it.
    const submittedType = String(fd.get('nodeType') ?? '').trim();
    const nodeType =
      isCanonicalNodeType(submittedType) || submittedType === currentNode.nodeType
        ? submittedType
        : currentNode.nodeType;
    const description = String(fd.get('description') ?? '').trim() || null;
    const alias = String(fd.get('alias') ?? '').trim() || null;
    const seqRaw = String(fd.get('seq') ?? '').trim();
    const seq = seqRaw !== '' ? parseInt(seqRaw, 10) : null;
    const tagsStr = String(fd.get('tags') ?? '').trim();
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    // Checkbox: present (value "true") when checked, absent when unchecked.
    // updateMeta rewrites the full meta set, so send an explicit boolean
    // either way (updateNode preserves omitted fields — an absent checkbox
    // would otherwise never uncheck).
    const isRunnable = fd.get('isRunnable') === 'true';
    const newLoc = cleanLocInput(String(fd.get('loc') ?? ''));

    if (!name) return fail(400, { error: 'Name is required' });

    // Move if loc changed. #237: route the move through the node's OWN
    // identity — #564 reshaped moveNode to sourceRef (the PK) + targetUrn
    // (the full destination node URN, composed from the node's own memory
    // urn), so a stale URL can't redirect the move anyway. An occupied
    // destination fails loudly with NODE_ALREADY_EXISTS (#501).
    const loc = newLoc && newLoc !== currentNode.loc ? newLoc : currentNode.loc;
    if (loc !== currentNode.loc) {
      if (!currentNode.memory?.urn) {
        return fail(500, { error: 'Node has no memory URN to move by.' });
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
        return fail(status, { error: extractGqlError(e, 'Failed to move node') });
      }
    }

    try {
      await client.request(UPDATE_NODE_MUTATION, {
        input: { memoryId: currentNode.memoryId, loc, name, nodeType, description, alias, seq: Number.isNaN(seq) ? null : seq, tags, isRunnable },
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to save' });
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
      NODE_BY_ID_QUERY, { id: params.nodeId },
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

  updateContent: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const content = String(fd.get('content') ?? '');

    const client = gqlClient(locals.token);
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      await client.request(UPDATE_NODE_MUTATION, {
        input: {
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
        },
      });
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
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      await client.request(UPDATE_NODE_MUTATION, {
        input: {
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          // #235: explicit tags pass-through — no longer load-bearing
          // under updateNode, kept deliberately. See updateContent.
          tags: node.tags ?? [],
          abstract,
        },
      });
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
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return fail(404, { error: 'Node not found' });

      await client.request(UPDATE_NODE_MUTATION, {
        input: {
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          // #235: explicit tags pass-through — no longer load-bearing
          // under updateNode, kept deliberately. See updateContent.
          tags: node.tags ?? [],
          data,
        },
      });
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
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });

      const merged: Record<string, unknown> = {
        ...(node.data && typeof node.data === 'object' && !Array.isArray(node.data) ? node.data : {}),
      };
      if (rows.length > 0) merged.extractionSpec = rowsToSpec(rows);
      else delete merged.extractionSpec;
      if (writeTo !== '') merged.output = { writeTo, mode };
      else delete merged.output;

      await client.request(UPDATE_NODE_MUTATION, {
        input: {
          // #237: memoryId from the node, not the URL.
          memoryId: node.memoryId,
          loc: node.loc,
          // #235: explicit tags pass-through — see updateContent.
          tags: node.tags ?? [],
          data: merged,
        },
      });
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

    // The redirect target's org segment comes from the form (the page only
    // offers the button when the org is known). A stale/wrong value is
    // harmless: the run detail page URL-corrects to run.organizationId.
    const orgId = form.data.orgId;

    const client = gqlClient(locals.token);
    let runId: string;
    try {
      const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
      if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
      if (!node.memory?.urn) {
        return message(form, { type: 'error', text: 'Node has no memory URN to run by.' }, { status: 500 });
      }
      const urn = composeNodeUrn(node.memory.urn, node.loc);

      const res = await client.request<{ runTask: string }>(RUN_TASK_APP_MUTATION, {
        urn,
        args,
        appRef: appId,
        runAsSelf: false,
      });
      runId = res.runTask;
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to start the run') }, { status: 500 });
    }
    redirect(303, `/app/orgs/${orgId}/apps/${appId}/runs/${runId}`);
  },

  // Duplicate (#501 / hadron-server#564): cloneNode into `<loc>-copy` beside
  // the original, stepping to -copy-2… when the slot is taken (cloneNode
  // fails loudly with NODE_ALREADY_EXISTS — never overwrites). Redirects to
  // the new node's page.
  duplicate: async ({ params, locals }) => {
    const client = gqlClient(locals.token);
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
    if (!node) return fail(404, { error: 'Node not found' });
    if (!node.memory?.urn) return fail(500, { error: 'Node has no memory URN to clone by.' });

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
          return fail(500, { error: extractGqlError(e, 'Failed to duplicate node') });
        }
      }
    }
    if (clonedId === null) {
      return fail(409, { error: 'Too many copies of this node already exist — rename one first.' });
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
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
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
    // No-op when the destination is where the node already lives. Compare with
    // the hrn:/urn: prefix stripped — the composed form is canonical (hrn:node:),
    // but a pasted URN may omit the prefix; both are valid targetUrn inputs.
    const bare = (u: string) => u.replace(/^(?:hrn|urn):node:/, '');
    if (bare(targetUrn) === bare(composeNodeUrn(node.memory.urn, node.loc))) {
      return message(form, { type: 'success', text: t('node-actions.move.noop', 'Node is already at that destination.') });
    }

    try {
      await client.request(MOVE_NODE_MUTATION, { sourceRef: node.id, targetUrn });
    } catch (e: unknown) {
      const status = extractGqlErrorCode(e) === 'NODE_ALREADY_EXISTS' ? 409 : 500;
      const error = extractGqlError(e, 'Failed to move node');
      return status === 409
        ? setError(form, 'target', error, { status })
        : message(form, { type: 'error', text: error }, { status });
    }
    redirect(303, `/app/memories/${node.memoryId}/nodes/${node.id}`);
  },

  // Convert to task (#503): flip isRunnable on so the node can be run headless.
  // updateNode preserves omitted fields, so this is a minimal patch — no
  // redirect; enhance re-runs load and the menu item drops off once it's a task.
  convertToTask: async ({ params, locals }) => {
    const client = gqlClient(locals.token);
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: params.nodeId });
    if (!node) return fail(404, { error: 'Node not found' });
    try {
      await client.request(UPDATE_NODE_MUTATION, {
        input: {
          memoryId: node.memoryId,
          loc: node.loc,
          // #235: explicit tags pass-through — see updateContent.
          tags: node.tags ?? [],
          isRunnable: true,
        },
      });
      return { convertedToTask: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to convert node to a task') });
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
        NODE_BY_ID_QUERY, { id: params.nodeId },
      );
      if (!node) return message(form, { type: 'error', text: 'Node not found' }, { status: 404 });
      await client.request(UPDATE_NODE_MUTATION, {
        input: {
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
        },
      });
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
      NODE_BY_ID_QUERY, { id: params.nodeId },
    );
    if (!anchorNode) return fail(404, { error: 'Anchor node not found' });
    try {
      for (const u of updates) {
        // #335 (closes the #234 follow-up): scope the read to the anchor's
        // memory. Previously NODE_QUERY(loc:) was memory-blind, so a foreign
        // memory sharing the loc could win the resolver's first-match and feed
        // a wrong `name` into anchorNode.memoryId's row. Now it's pinned.
        const { node } = await client.request<{ node: MemoryNode | null }>(NODE_QUERY, { loc: u.loc, memory: anchorNode.memoryId });
        if (!node) continue;
        await client.request(UPDATE_NODE_MUTATION, {
          input: {
            memoryId: anchorNode.memoryId,
            loc: u.loc,
            // #235: explicit tags pass-through — no longer load-bearing
            // under updateNode, kept deliberately. See updateContent.
            tags: node.tags ?? [],
            seq: u.seq,
          },
        });
      }
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Reorder failed' });
    }
  },
};
