import { fail, error } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATIONS_QUERY, CREATE_EDGE_MUTATION, UPDATE_EDGE_MUTATION, DELETE_EDGE_MUTATION } from '$lib/server/queries';
import { userFacingErrorMessage } from '$lib/edge-conditions/error-messages';
import { parseConditionField, parsePriorityField } from '$lib/flow/edge-form';
import {
  buildConversationEdgeDetails,
  conversationEdgeInputsFromNodes,
  isConversationLoc,
  isStageLoc,
} from '$lib/flow/conversation-canvas';
import {
  conversationEdgePanelDefaults,
  conversationEdgePanelSchema,
  parseValidatedConversationEdgeData,
} from '$lib/flow/conversation-edge-panel-form';
import {
  conversationGoalsDefaults,
  conversationGoalsSchema,
  linesToGoalList,
} from '$lib/flow/conversation-goals-form';
import {
  conversationStageExtractionDefaults,
  conversationStageExtractionSchema,
  parseValidatedExtractionSpec,
} from '$lib/flow/conversation-stage-extraction-form';
import {
  parseValidatedPanelCondition,
  parseValidatedPanelPriority,
} from '$lib/flow/edge-panel-form';
import { createNodeErrorCode } from '$lib/i18n/create-node-strings';
import { t } from '$lib/i18n/t';
import type { Organization, MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

type ConversationEdgePanelForm = Infer<typeof conversationEdgePanelSchema, 'zod4'>;
type ConversationGoalsForm = Infer<typeof conversationGoalsSchema, 'zod4'>;
type ConversationStageExtractionForm = Infer<typeof conversationStageExtractionSchema, 'zod4'>;

const conversationEdgePanelFormAdapter = zod4(conversationEdgePanelSchema);
const conversationGoalsFormAdapter = zod4(conversationGoalsSchema);
const conversationStageExtractionFormAdapter = zod4(conversationStageExtractionSchema);

// cor:api:090 — scope to the agent's system memory. findNodes hides
// class:'system' memories on a broad (no-memoryIds) call, so the system-memory
// nodes only come back when we name the memory in the filter (which also
// overrides the exclusion). Results are under `hits[].node`.
// Edge condition/priority/data feed the canvas rule annotations and the
// routing-rule side panel.
const GRAPH_NODES_QUERY = `
  query Nodes($limit: Int, $memoryIds: [ID!]) {
    findNodes(filter: { memoryIds: $memoryIds }, limit: $limit) {
      hits {
        node {
          id memoryId nodeType loc name description content tags seq data
          outgoingEdges { id name loc isRunnable condition priority data target { id loc name } }
        }
      }
    }
  }
`;

// #335: read a node's `data` scoped to a memory. `$memory` is required (ID!)
// so an unscoped call can't compile/run — node(loc:) without a scope now
// errors on a cross-memory loc collision (AMBIGUOUS_NODE_LOC). Shared by the
// stageOrder reads in addStage / updateExtractionSpec / updateGoals.
const NODE_DATA_BY_LOC_QUERY = `query N($loc: ID!, $memory: ID!) { node(ref: $loc, memoryRef: $memory) { data } }`;

// hadron-server#460: upsertNode is split into createNode (create-only,
// NodeLocConflictError on a live (memoryId, loc)) and updateNode (never
// creates — NODE_NOT_FOUND on miss; omitted fields are preserved, so the
// data-merge writes below no longer need to re-assert name/nodeType).
const CREATE = `mutation C($input: CreateNodeInput!) { createNode(input: $input) { id } }`;
const UPDATE = `mutation U($input: UpdateNodeInput!) { updateNode(input: $input) { id } }`;

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  // Find the agent across all orgs. No .catch here — coercing an org-query
  // failure into an empty list would turn transient errors into a misleading
  // "Agent not found" 404 (the spec-018 false-404 class; see the agent detail
  // loader and the portal's no-silent-loader-catch review convention).
  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');

  let agent = null;
  let org = null;
  for (const o of orgs) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) { agent = found; org = o; break; }
  }
  if (!agent || !org) throw error(404, 'Agent not found');

  const systemMemoryId = (agent as any).systemMemoryId as string | null;
  if (!systemMemoryId) throw error(400, 'Agent has no system memory');

  // Load system memory nodes (scoped to the agent's system memory).
  const nodesData = await client.request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(
    GRAPH_NODES_QUERY, { limit: 500, memoryIds: [systemMemoryId] },
  );
  const systemNodes = (nodesData.findNodes?.hits ?? [])
    .map((h) => h.node)
    .filter((n) => n.memoryId === systemMemoryId);

  // Prompts feed the stage panel's editor and the shared-partials section;
  // the canvas view-model derives everything else from systemNodes client-side.
  const prompts = systemNodes.filter((n) => n.loc.startsWith('prompts:'));
  const edgeInputs = conversationEdgeInputsFromNodes(systemNodes);
  const edgeDetails = buildConversationEdgeDetails(systemNodes, edgeInputs);
  const edgeForms = Object.fromEntries(
    await Promise.all(
      edgeDetails.map(async (edge) => [
        edge.id,
        await superValidate<ConversationEdgePanelForm>(
          conversationEdgePanelDefaults(edge),
          conversationEdgePanelFormAdapter,
          { errors: false },
        ),
      ]),
    ),
  );
  const stageExtractionForms = Object.fromEntries(
    await Promise.all(
      systemNodes
        .filter((n) => isStageLoc(n.loc))
        .map(async (stage) => {
          const data = (stage.data as Record<string, unknown>) ?? {};
          const extractionSpec = Array.isArray(data.extractionSpec) ? data.extractionSpec : [];
          return [
            stage.id,
            await superValidate<ConversationStageExtractionForm>(
              conversationStageExtractionDefaults({ loc: stage.loc, extractionSpec }, systemMemoryId),
              conversationStageExtractionFormAdapter,
              { errors: false },
            ),
          ];
        }),
    ),
  );
  const conversationGoalForms = Object.fromEntries(
    await Promise.all(
      systemNodes
        .filter((n) => isConversationLoc(n.loc))
        .map(async (conversation) => {
          const data = (conversation.data as Record<string, unknown>) ?? {};
          const goalDescriptions = Array.isArray(data.goalDescriptions)
            ? data.goalDescriptions.filter((g): g is string => typeof g === 'string')
            : [];
          const goalSignals = Array.isArray(data.goalSignals)
            ? data.goalSignals.filter((g): g is string => typeof g === 'string')
            : [];
          return [
            conversation.id,
            await superValidate<ConversationGoalsForm>(
              conversationGoalsDefaults({ loc: conversation.loc, goalDescriptions, goalSignals }, systemMemoryId),
              conversationGoalsFormAdapter,
              { errors: false },
            ),
          ];
        }),
    ),
  );

  return { agent, org, systemMemoryId, prompts, systemNodes, edgeForms, stageExtractionForms, conversationGoalForms };
};

export const actions: Actions = {
  addConversation: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'Name is required' });

    const slug = name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();

    try {
      // Create-only: a duplicate slug now fails (the old upsert silently
      // reset the existing conversation's stageOrder to []).
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: `conversations:${slug}`, name: slug, nodeType: 'system',
        description: name, data: { stageOrder: [] },
      }});
    } catch (e: unknown) {
      if (createNodeErrorCode(e) === 'NodeLocConflictError') {
        return fail(400, { error: 'A conversation with this name already exists' });
      }
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  addStage: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const conversationLoc = String(fd.get('conversationLoc') ?? '');
    const stageName = String(fd.get('stageName') ?? '').trim();
    if (!stageName) return fail(400, { error: 'Stage name is required' });

    const slug = stageName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();

    try {
      // Create stage node — create-only. A duplicate stage slug now fails
      // with a friendly 400 (the old upsert silently reset the stage's
      // extractionSpec and appended a duplicate entry to stageOrder).
      try {
        await client.request(CREATE, { input: {
          memoryId: systemMemoryId, loc: `${conversationLoc}:${slug}`, name: slug, nodeType: 'system',
          description: stageName,
          data: { promptRef: `prompts:${conversationLoc.replace('conversations:', '')}:${slug}`, extractionSpec: [] },
        }});
      } catch (e: unknown) {
        if (createNodeErrorCode(e) === 'NodeLocConflictError') {
          return fail(400, { error: 'A stage with this name already exists in this conversation' });
        }
        throw e;
      }

      // Create prompt node. An orphaned prompt may already live at this loc
      // (e.g. from an earlier stage) — keep it rather than clobbering the
      // user's prompt text with the placeholder (the old upsert overwrote).
      try {
        await client.request(CREATE, { input: {
          memoryId: systemMemoryId,
          loc: `prompts:${conversationLoc.replace('conversations:', '')}:${slug}`,
          name: slug, nodeType: 'system',
          content: `Stage: ${stageName}\n\n[Edit this prompt]`,
        }});
      } catch (e: unknown) {
        if (createNodeErrorCode(e) !== 'NodeLocConflictError') throw e;
      }

      // Update conversation's stageOrder
      const convNode = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc: conversationLoc, memory: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      // Append idempotently — a stale stageOrder that already lists the slug
      // (e.g. a leftover from a deleted stage) must not gain a duplicate.
      const existingOrder = (convData.stageOrder as string[]) ?? [];
      const stageOrder = existingOrder.includes(slug) ? existingOrder : [...existingOrder, slug];
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc: conversationLoc, data: { ...convData, stageOrder },
      }});
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  updatePrompt: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const loc = String(fd.get('loc') ?? '');
    const content = String(fd.get('content') ?? '');

    try {
      // A stage's promptRef can dangle (the editor opens with empty content
      // for a prompt node that doesn't exist yet), so this flow relied on
      // upsert's create-on-miss: update first, create on NODE_NOT_FOUND.
      try {
        await client.request(UPDATE, { input: {
          memoryId: systemMemoryId, loc, content,
        }});
      } catch (e: unknown) {
        if (createNodeErrorCode(e) !== 'NODE_NOT_FOUND') throw e;
        try {
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc, name: loc.split(':').pop()!, nodeType: 'system', content,
          }});
        } catch (e2: unknown) {
          // Lost the create race — a concurrent request created the prompt
          // between our failed update and this create. The desired end state
          // is "prompt exists with this content", so retry the update once.
          if (createNodeErrorCode(e2) !== 'NodeLocConflictError') throw e2;
          await client.request(UPDATE, { input: {
            memoryId: systemMemoryId, loc, content,
          }});
        }
      }
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  updateExtractionSpec: async ({ request, locals }) => {
    const form = await superValidate<ConversationStageExtractionForm>(
      await request.formData(),
      conversationStageExtractionFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const systemMemoryId = form.data.systemMemoryId;
    const stageLoc = form.data.stageLoc;
    const spec = parseValidatedExtractionSpec(form.data.extractionSpec);
    const client = gqlClient(locals.token);

    try {
      const stageNode = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc: stageLoc, memory: systemMemoryId },
      );
      const stageData = (stageNode.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc: stageLoc, data: { ...stageData, extractionSpec: spec },
      }});
      return message(form, {
        type: 'success',
        text: t('conversation.stagePanel.extraction.saved', 'Extraction saved.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: userFacingErrorMessage(e, 'Failed to update extraction spec') },
        { status: 500 },
      );
    }
  },

  updateGoals: async ({ request, locals }) => {
    const form = await superValidate<ConversationGoalsForm>(
      await request.formData(),
      conversationGoalsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const systemMemoryId = form.data.systemMemoryId;
    const convLoc = form.data.convLoc;
    const goalDescriptions = linesToGoalList(form.data.goalDescriptionsText);
    const goalSignals = linesToGoalList(form.data.goalSignalsText);

    try {
      const convNode = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc: convLoc, memory: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc: convLoc, data: { ...convData, goalDescriptions, goalSignals },
      }});
      return message(form, {
        type: 'success',
        text: t('conversation.infoPanel.goals.saved', 'Goals saved.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: userFacingErrorMessage(
            e,
            t('conversation.infoPanel.goals.updateFailed', 'Failed to update goals'),
          ),
        },
        { status: 500 },
      );
    }
  },

  addEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const sourceNodeId = String(fd.get('sourceNodeId') ?? '');
    const targetNodeId = String(fd.get('targetNodeId') ?? '');
    const name = String(fd.get('name') ?? '');
    const dataJson = String(fd.get('data') ?? '{}');

    if (!sourceNodeId || !targetNodeId) return fail(400, { error: 'Source and target are required' });

    let data: Record<string, unknown>;
    try { data = JSON.parse(dataJson); } catch { return fail(400, { error: 'Invalid JSON in edge data' }); }
    const condition = parseConditionField(fd.get('condition'));
    if (!condition.ok) return fail(400, { error: condition.error });
    const priority = parsePriorityField(fd.get('priority'));
    if (!priority.ok) return fail(400, { error: priority.error });

    try {
      const res = await client.request<{ createEdge: { id: string } }>(CREATE_EDGE_MUTATION, {
        sourceNodeId,
        targetNodeId,
        name: name || 'edge',
        condition: condition.value,
        priority: priority.value,
        data,
      });
      // The canvas selects the fresh edge so its rule can be refined.
      return { created: true, edgeId: res.createEdge.id };
    } catch (e: unknown) {
      return fail(400, { error: userFacingErrorMessage(e, 'Failed to create edge') });
    }
  },

  // Saves the rule panel's editable set: name, priority, condition, and data
  // (timing/behavior — the panel merges them into the stored data object,
  // since the data variable REPLACES the whole value server-side).
  updateEdge: async ({ request, locals }) => {
    const form = await superValidate<ConversationEdgePanelForm>(
      await request.formData(),
      conversationEdgePanelFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const edgeId = form.data.edgeId;
    const name = form.data.name || null;
    const priority = parseValidatedPanelPriority(form.data.priority);
    const condition = parseValidatedPanelCondition(form.data.condition);
    const data = parseValidatedConversationEdgeData(form.data.data);

    try {
      await gqlClient(locals.token).request(UPDATE_EDGE_MUTATION, {
        edgeId,
        name,
        condition,
        priority,
        data,
      });
      return message(form, { type: 'success', text: t('conversation.edgePanel.saved', 'Rule saved.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: userFacingErrorMessage(e, 'Failed to update edge') },
        { status: 500 },
      );
    }
  },

  // Persists a canvas drag as data.position on the node (stage positions are
  // parent-relative). Fire-and-forget from the client — no invalidation, the
  // canvas already shows the dragged position.
  savePosition: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const loc = String(fd.get('loc') ?? '');
    const x = Number(fd.get('x'));
    const y = Number(fd.get('y'));
    if (!systemMemoryId || !loc || !Number.isFinite(x) || !Number.isFinite(y)) {
      return fail(400, { error: 'Invalid position' });
    }

    try {
      const node = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc, memory: systemMemoryId },
      );
      const nodeData = (node.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc, data: { ...nodeData, position: { x, y } },
      }});
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to save position' });
    }
  },

  deleteEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const edgeId = String(fd.get('edgeId') ?? '');
    if (!edgeId) return fail(400, { error: 'edgeId is required' });
    try {
      await client.request(DELETE_EDGE_MUTATION, { edgeId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete edge' });
    }
  },
};
