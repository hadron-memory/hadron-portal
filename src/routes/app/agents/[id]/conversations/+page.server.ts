import { extractGqlError } from '$lib/server/gqlError';
import { fail, error } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { drainFindNodes, fetchAllItems } from '$lib/server/paginate';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATIONS_QUERY, CREATE_EDGE_MUTATION, UPDATE_EDGE_MUTATION, DELETE_EDGE_MUTATION } from '$lib/server/queries';
import { entryConditionErrorMessage, userFacingErrorMessage } from '$lib/edge-conditions/error-messages';
// #870: the chooser picks each write's mutation from the node's kind. Called
// INLINE at every `.request()` — hoisting it into a local makes the call
// opaque to check-graphql-callers, which then stops checking its variables.
import { nodeUpdateDocument } from '$lib/server/nodeKindDoor';
import {
  buildConversationEdgeDetails,
  conversationEdgeInputsFromNodes,
  isConversationLoc,
  isStageLoc,
} from '$lib/flow/conversation-canvas';
import { addStageDefaults, addStageSchema } from '$lib/flow/conversation-add-stage-form';
import {
  conversationEdgePanelDefaults,
  conversationEdgePanelSchema,
  parseValidatedConversationEdgeData,
} from '$lib/flow/conversation-edge-panel-form';
import {
  conversationEntryConditionDefaults,
  conversationEntryConditionSchema,
} from '$lib/flow/conversation-entry-condition-form';
import { conversationMoveDefaults, conversationMoveSchema } from '$lib/flow/conversation-move-form';
import { planStartOrderMove } from '$lib/flow/conversation-order';
import {
  conversationGoalsDefaults,
  conversationGoalsSchema,
  linesToGoalList,
} from '$lib/flow/conversation-goals-form';
import {
  conversationPromptDefaults,
  conversationPromptSchema,
} from '$lib/flow/conversation-prompt-form';
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
import { addConversationSchema, addEdgeSchema } from './schema';

type AddConversationForm = Infer<typeof addConversationSchema, 'zod4'>;
type AddEdgeForm = Infer<typeof addEdgeSchema, 'zod4'>;
type AddStageForm = Infer<typeof addStageSchema, 'zod4'>;
type ConversationEdgePanelForm = Infer<typeof conversationEdgePanelSchema, 'zod4'>;
type ConversationGoalsForm = Infer<typeof conversationGoalsSchema, 'zod4'>;
type ConversationEntryConditionForm = Infer<typeof conversationEntryConditionSchema, 'zod4'>;
type ConversationMoveForm = Infer<typeof conversationMoveSchema, 'zod4'>;
type ConversationPromptForm = Infer<typeof conversationPromptSchema, 'zod4'>;
type ConversationStageExtractionForm = Infer<typeof conversationStageExtractionSchema, 'zod4'>;

const addConversationFormAdapter = zod4(addConversationSchema);
const addEdgeFormAdapter = zod4(addEdgeSchema);
const addStageFormAdapter = zod4(addStageSchema);
const conversationEdgePanelFormAdapter = zod4(conversationEdgePanelSchema);
const conversationGoalsFormAdapter = zod4(conversationGoalsSchema);
const conversationEntryConditionFormAdapter = zod4(conversationEntryConditionSchema);
const conversationMoveFormAdapter = zod4(conversationMoveSchema);
const conversationPromptFormAdapter = zod4(conversationPromptSchema);
const conversationStageExtractionFormAdapter = zod4(conversationStageExtractionSchema);

// hrn:node:hadronmemory.com:specs:cor:api:090:02: naming the system memory
// bypasses the memory-class exclusion, but not the independent node-type
// default. Read both the default non-system nodes and explicit system nodes
// (#874): the editor writes system nodes, while directly authored conversations
// can use other types accepted by the runtime. Results are under hits[].node.
// Edge condition/priority/data feed the canvas rule annotations and the
// routing-rule side panel.
const CONVERSATION_NODES_QUERY = /* GraphQL */ `
  query ConversationNodes($limit: Int, $offset: Int, $memoryIds: [ID!], $nodeType: String) {
    findNodes(filter: { memoryIds: $memoryIds, nodeType: $nodeType }, limit: $limit, offset: $offset) {
      hits {
        node {
          id memoryId urn nodeType loc name description content tags seq data
          outgoingEdges { id name loc isRunnable condition priority data target { id loc name } }
        }
      }
    }
  }
`;

// S7: what the start-order move needs to plan its writes — each conversation's
// seq and its setup/fallback flags, nothing else.
const CONVERSATION_ORDER_QUERY = /* GraphQL */ `
  query ConversationOrder($limit: Int, $offset: Int, $memoryIds: [ID!], $nodeType: String) {
    findNodes(filter: { memoryIds: $memoryIds, nodeType: $nodeType }, limit: $limit, offset: $offset) {
      hits { node { id memoryId loc seq data } }
    }
  }
`;

// #335: read a node's `data` scoped to a memory. `$memoryRef` is required (ID!)
// so an unscoped call can't compile/run — node(loc:) without a scope now
// errors on a cross-memory loc collision (AMBIGUOUS_NODE_LOC). Shared by the
// stageOrder reads in addStage / updateExtractionSpec / updateGoals.
//
// #870: it also carries `role` and `isRunnable` — the two GOVERNANCE SIGNALS.
// Every write below picks its mutation from them, because the server refuses a
// generic `updateNode` against a governed node and these reads are what the
// door is chosen from. Not rendered; read only by nodeUpdateDocument.
const NODE_DATA_BY_LOC_QUERY = /* GraphQL */ `query NodeDataByLoc($ref: ID!, $memoryRef: ID!) { node(ref: $ref, memoryRef: $memoryRef) { data role isRunnable } }`;

/**
 * What the read above returns: the node's `data` plus the signals the door is
 * chosen from. A missing node is `null` and routes as "no prior kind".
 */
type ConversationNodeRow = { data: unknown; role: string | null; isRunnable: boolean | null };

// hadron-server#460: upsertNode is split into createNode (create-only,
// NodeLocConflictError on a live (memoryId, loc)) and updateNode (never
// creates — NODE_NOT_FOUND on miss; omitted fields are preserved, so the
// data-merge writes below no longer need to re-assert name/nodeType).
const CREATE = /* GraphQL */ `mutation CreateConversationNode($input: CreateNodeInput!) { createNode(input: $input) { id } }`;
// #870: there is no local UPDATE document any more. Every write in this file
// goes through nodeUpdateDocument, which picks the mutation from the node's
// kind — the generic one this file used to declare was refused by the server
// against any governed node, and being locally declared it was invisible to
// every GraphQL gate in the repo (#872). Do not reintroduce it: the door gate
// fails a node-update document declared here.

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

  // Preserve directly authored nodes while including the editor's system type.
  // Either read failing must fail the loader rather than show a partial canvas.
  const [defaultNodes, typedNodes] = await Promise.all([
    drainFindNodes<{ node: MemoryNode }>(client, CONVERSATION_NODES_QUERY, { memoryIds: [systemMemoryId] }),
    drainFindNodes<{ node: MemoryNode }>(client, CONVERSATION_NODES_QUERY, { memoryIds: [systemMemoryId], nodeType: 'system' }),
  ]);
  const systemNodes = Array.from(new Map(
    [...(defaultNodes.findNodes?.hits ?? []), ...(typedNodes.findNodes?.hits ?? [])]
      .map((h) => h.node)
      .filter((n) => n.memoryId === systemMemoryId)
      .map((n) => [n.id, n]),
  ).values());

  // Prompts feed the stage panel's editor and the shared-partials section;
  // the canvas view-model derives everything else from systemNodes client-side.
  const prompts = systemNodes.filter((n) => n.loc.startsWith('prompts:'));
  const promptByLoc = new Map(prompts.map((prompt) => [prompt.loc, prompt]));
  const promptFormLocs = new Set(prompts.map((prompt) => prompt.loc));
  for (const stage of systemNodes.filter((n) => isStageLoc(n.loc))) {
    const data = (stage.data as Record<string, unknown>) ?? {};
    if (typeof data.promptRef === 'string' && data.promptRef) promptFormLocs.add(data.promptRef);
  }
  const promptForms = Object.fromEntries(
    await Promise.all(
      Array.from(promptFormLocs).map(async (promptLoc) => [
        promptLoc,
        await superValidate<ConversationPromptForm>(
          conversationPromptDefaults({ loc: promptLoc, content: promptByLoc.get(promptLoc)?.content ?? '' }, systemMemoryId),
          conversationPromptFormAdapter,
          { errors: false },
        ),
      ]),
    ),
  );
  const addConversationForm = await superValidate<AddConversationForm>(
    { systemMemoryId, name: '' },
    addConversationFormAdapter,
    { errors: false },
  );
  const addEdgeForm = await superValidate<AddEdgeForm>(
    { sourceNodeId: '', targetNodeId: '', name: '', condition: 'null', priority: '0', data: '{}' },
    addEdgeFormAdapter,
    { errors: false },
  );
  const addStageForms = Object.fromEntries(
    await Promise.all(
      systemNodes
        .filter((n) => isConversationLoc(n.loc))
        .map(async (conversation) => [
          conversation.id,
          await superValidate<AddStageForm>(
            addStageDefaults({ loc: conversation.loc }, systemMemoryId),
            addStageFormAdapter,
            { errors: false },
          ),
        ]),
    ),
  );
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

  // S7: the Start section's two forms per ordinary conversation — the entry
  // condition (seeded from data.entryCondition) and the order move.
  const conversationStartForms = Object.fromEntries(
    await Promise.all(
      systemNodes
        .filter((n) => isConversationLoc(n.loc))
        .map(async (conversation) => {
          const data = (conversation.data as Record<string, unknown>) ?? {};
          return [
            conversation.id,
            {
              condition: await superValidate<ConversationEntryConditionForm>(
                conversationEntryConditionDefaults(
                  { loc: conversation.loc, entryCondition: data.entryCondition ?? null },
                  systemMemoryId,
                ),
                conversationEntryConditionFormAdapter,
                { errors: false, id: 'conversationEntryCondition' },
              ),
              move: await superValidate<ConversationMoveForm>(
                conversationMoveDefaults({ loc: conversation.loc }, systemMemoryId),
                conversationMoveFormAdapter,
                { errors: false, id: 'conversationMove' },
              ),
            },
          ];
        }),
    ),
  );

  return {
    agent,
    org,
    systemMemoryId,
    prompts,
    systemNodes,
    addConversationForm,
    addEdgeForm,
    addStageForms,
    promptForms,
    edgeForms,
    stageExtractionForms,
    conversationGoalForms,
    conversationStartForms,
  };
};

export const actions: Actions = {
  addConversation: async ({ request, locals }) => {
    const form = await superValidate<AddConversationForm>(
      await request.formData(),
      addConversationFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const systemMemoryId = form.data.systemMemoryId;
    const name = form.data.name;
    const slug = name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();

    try {
      // Create-only: a duplicate slug now fails (the old upsert silently
      // reset the existing conversation's stageOrder to []).
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: `conversations:${slug}`, name: slug, nodeType: 'system',
        description: name, data: { stageOrder: [] },
      }});
      return message(form, {
        type: 'success',
        text: t('conversation.editor.addConversation.saved', 'Conversation added.'),
      });
    } catch (e: unknown) {
      if (createNodeErrorCode(e) === 'NodeLocConflictError') {
        return setError(
          form,
          'name',
          t('conversation.editor.addConversation.duplicate', 'A conversation with this name already exists'),
          { status: 400 },
        );
      }
      return message(
        form,
        {
          type: 'error',
          text: userFacingErrorMessage(
            e,
            t('conversation.editor.addConversation.failed', 'Failed to add conversation'),
          ),
        },
        { status: 500 },
      );
    }
  },

  addStage: async ({ request, locals }) => {
    const form = await superValidate<AddStageForm>(
      await request.formData(),
      addStageFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const systemMemoryId = form.data.systemMemoryId;
    const conversationLoc = form.data.conversationLoc;
    const stageName = form.data.stageName;

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
          return setError(
            form,
            'stageName',
            t('conversation.infoPanel.addStage.duplicate', 'A stage with this name already exists in this conversation'),
            { status: 400 },
          );
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
      const convNode = await client.request<{ node: ConversationNodeRow | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { ref: conversationLoc, memoryRef: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      // Append idempotently — a stale stageOrder that already lists the slug
      // (e.g. a leftover from a deleted stage) must not gain a duplicate.
      const existingOrder = (convData.stageOrder as string[]) ?? [];
      const stageOrder = existingOrder.includes(slug) ? existingOrder : [...existingOrder, slug];
      // #870: the door follows the node's kind. This edit touches neither
      // signal, so the resulting kind is the node's current one — which is why
      // the read above, not the input, decides it.
      const input = {
        memoryId: systemMemoryId, loc: conversationLoc, data: { ...convData, stageOrder },
      };
      await client.request(nodeUpdateDocument(convNode.node, input), { input });
      return message(form, {
        type: 'success',
        text: t('conversation.infoPanel.addStage.saved', 'Stage added.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: userFacingErrorMessage(
            e,
            t('conversation.infoPanel.addStage.failed', 'Failed to add stage'),
          ),
        },
        { status: 500 },
      );
    }
  },

  updatePrompt: async ({ request, locals }) => {
    const form = await superValidate<ConversationPromptForm>(
      await request.formData(),
      conversationPromptFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const systemMemoryId = form.data.systemMemoryId;
    const loc = form.data.loc;
    const content = form.data.content;

    try {
      // A stage's promptRef can dangle — the editor opens with empty content
      // for a prompt node that doesn't exist yet — so this flow used to rely on
      // upsert's create-on-miss: update first, create on NODE_NOT_FOUND.
      //
      // #870 turns that around: READ first, then create or update. The server
      // refuses a generic `updateNode` against a governed node, so an update
      // has to know the node's kind, and a write-first flow cannot. It costs
      // one read on a save that used to take none.
      //
      // Both races the old shape handled are preserved, and they are opposites:
      // the node can APPEAR between the read and the create (someone else made
      // it), and it can VANISH between the read and the update (someone deleted
      // it). The desired end state is the same either way — "the prompt exists
      // with this content" — so each falls through to the other's operation.
      //
      // Those two also COMPOUND: deleted after the read, then recreated before
      // our fallback create. That lands on the create-conflict path from the
      // other direction, which is why creating is one function rather than two
      // call sites that have to be kept in step — the first cut of #870 had
      // two, and only one of them retried, so the compound race escaped as a
      // 500 on a path the pre-#870 upsert recovered from.
      const input = { memoryId: systemMemoryId, loc, content };
      const createInput = {
        memoryId: systemMemoryId, loc, name: loc.split(':').pop()!, nodeType: 'system', content,
      };

      // Create, and on losing the create race adopt the winner: re-read rather
      // than assuming its kind, because the winner decided what this node is
      // and the door follows from that rather than from what we meant to create.
      const createOrAdoptWinner = async () => {
        try {
          await client.request(CREATE, { input: createInput });
        } catch (e: unknown) {
          if (createNodeErrorCode(e) !== 'NodeLocConflictError') throw e;
          const won = await client.request<{ node: ConversationNodeRow | null }>(
            NODE_DATA_BY_LOC_QUERY,
            { ref: loc, memoryRef: systemMemoryId },
          );
          await client.request(nodeUpdateDocument(won.node, input), { input });
        }
      };

      const existing = await client.request<{ node: ConversationNodeRow | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { ref: loc, memoryRef: systemMemoryId },
      );

      if (existing.node) {
        try {
          await client.request(nodeUpdateDocument(existing.node, input), { input });
        } catch (e: unknown) {
          // Deleted between the read and the write.
          if (createNodeErrorCode(e) !== 'NODE_NOT_FOUND') throw e;
          await createOrAdoptWinner();
        }
      } else {
        await createOrAdoptWinner();
      }
      return message(form, {
        type: 'success',
        text: t('conversation.prompt.saved', 'Prompt saved.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: userFacingErrorMessage(
            e,
            t('conversation.prompt.updateFailed', 'Failed to update prompt'),
          ),
        },
        { status: 500 },
      );
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
      const stageNode = await client.request<{ node: ConversationNodeRow | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { ref: stageLoc, memoryRef: systemMemoryId },
      );
      const stageData = (stageNode.node?.data as Record<string, unknown>) ?? {};
      // #870: neither signal is touched — the door follows the current kind.
      const input = {
        memoryId: systemMemoryId, loc: stageLoc, data: { ...stageData, extractionSpec: spec },
      };
      await client.request(nodeUpdateDocument(stageNode.node, input), { input });
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
      const convNode = await client.request<{ node: ConversationNodeRow | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { ref: convLoc, memoryRef: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      // #870: neither signal is touched — the door follows the current kind.
      const input = {
        memoryId: systemMemoryId, loc: convLoc, data: { ...convData, goalDescriptions, goalSignals },
      };
      await client.request(nodeUpdateDocument(convNode.node, input), { input });
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

  // S7 (B4): one click moves one conversation a step in the start order. It
  // reads the stored order fresh, so a stale page cannot plan from old numbers,
  // then writes only `seq`, one conversation at a time. A refused write stops
  // the sequence and the writes already made stay; the page reloads the stored
  // order and the error says the order was only partly saved.
  moveConversation: async ({ request, locals }) => {
    const form = await superValidate<ConversationMoveForm>(
      await request.formData(),
      conversationMoveFormAdapter,
      { id: 'conversationMove' },
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const systemMemoryId = form.data.systemMemoryId;
    let written = 0;

    try {
      const [defaultNodes, typedNodes] = await Promise.all([
        drainFindNodes<{ node: MemoryNode }>(client, CONVERSATION_ORDER_QUERY, { memoryIds: [systemMemoryId] }),
        drainFindNodes<{ node: MemoryNode }>(client, CONVERSATION_ORDER_QUERY, { memoryIds: [systemMemoryId], nodeType: 'system' }),
      ]);
      const conversations = Array.from(new Map(
        [...defaultNodes.findNodes.hits, ...typedNodes.findNodes.hits]
          .map((h) => h.node)
          .filter((n) => n.memoryId === systemMemoryId && isConversationLoc(n.loc))
          .map((n) => [n.id, n]),
      ).values());

      for (const write of planStartOrderMove(conversations, form.data.convLoc, form.data.direction)) {
        const prior = await client.request<{ node: ConversationNodeRow | null }>(
          NODE_DATA_BY_LOC_QUERY,
          { ref: write.loc, memoryRef: systemMemoryId },
        );
        // seq only: no `data` field, so a reorder cannot touch goals, stageOrder,
        // position or the entry condition.
        const input = { memoryId: systemMemoryId, loc: write.loc, seq: write.seq };
        await client.request(nodeUpdateDocument(prior.node, input), { input });
        written++;
      }
      return message(form, {
        type: 'success',
        text: t('conversation.infoPanel.start.orderSaved', 'Start order saved.'),
      });
    } catch {
      // Never the raw server message: say what state the order is in.
      return message(
        form,
        {
          type: 'error',
          text: written > 0
            ? t('conversation.infoPanel.start.orderPartial', 'Start order was only partly saved, so the order shown may be out of date. Reload it, then try again.')
            : t('conversation.infoPanel.start.orderFailed', 'Could not change the start order. Try again.'),
        },
        { status: 500 },
      );
    }
  },

  // S7: save or clear a conversation's entry condition. Spreads the stored data
  // (updateGoals pattern) so goals, stageOrder, position and any key this editor
  // does not know survive; Clear removes only `entryCondition`.
  updateEntryCondition: async ({ request, locals }) => {
    const form = await superValidate<ConversationEntryConditionForm>(
      await request.formData(),
      conversationEntryConditionFormAdapter,
      { id: 'conversationEntryCondition' },
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const systemMemoryId = form.data.systemMemoryId;
    const convLoc = form.data.convLoc;
    const condition = parseValidatedPanelCondition(form.data.condition);
    const clearing = form.data.intent === 'clear' || condition === null;

    try {
      const convNode = await client.request<{ node: ConversationNodeRow | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { ref: convLoc, memoryRef: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      // Setup and fallback never start by condition (Q13).
      if (convData.isSetup === true || convData.isFallback === true) {
        return message(
          form,
          {
            type: 'error',
            text: t('conversation.infoPanel.start.notOrdinary', 'Setup and fallback conversations have no start condition.'),
          },
          { status: 400 },
        );
      }
      const { entryCondition: _previous, ...rest } = convData;
      const input = {
        memoryId: systemMemoryId,
        loc: convLoc,
        data: clearing ? rest : { ...rest, entryCondition: condition },
      };
      await client.request(nodeUpdateDocument(convNode.node, input), { input });
      return message(form, {
        type: 'success',
        text: clearing
          ? t('conversation.infoPanel.start.cleared', 'Cleared. This conversation now always starts.')
          : t('conversation.infoPanel.start.saved', 'Start condition saved.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: entryConditionErrorMessage(
            e,
            t('conversation.infoPanel.start.saveFailed', 'Failed to save the start condition.'),
          ),
        },
        { status: 500 },
      );
    }
  },

  addEdge: async ({ request, locals }) => {
    const form = await superValidate<AddEdgeForm>(
      await request.formData(),
      addEdgeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    const condition = parseValidatedPanelCondition(form.data.condition);
    const priority = parseValidatedPanelPriority(form.data.priority);
    const data = parseValidatedConversationEdgeData(form.data.data);

    try {
      const res = await client.request<{ createEdge: { id: string } }>(CREATE_EDGE_MUTATION, {
        sourceRef: form.data.sourceNodeId,
        targetRef: form.data.targetNodeId,
        name: form.data.name || 'edge',
        condition,
        priority,
        data,
      });
      // The canvas selects the fresh edge so its rule can be refined.
      return {
        created: true,
        edgeId: res.createEdge.id,
        ...message(form, {
          type: 'success',
          text: t('conversation.edge.added', 'Rule added.'),
        }),
      };
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          text: userFacingErrorMessage(
            e,
            t('conversation.edge.addFailed', 'Failed to create edge'),
          ),
        },
        { status: 500 },
      );
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
        edgeRef: edgeId,
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
      const node = await client.request<{ node: ConversationNodeRow | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { ref: loc, memoryRef: systemMemoryId },
      );
      const nodeData = (node.node?.data as Record<string, unknown>) ?? {};
      // #870: neither signal is touched — the door follows the current kind.
      const input = {
        memoryId: systemMemoryId, loc, data: { ...nodeData, position: { x, y } },
      };
      await client.request(nodeUpdateDocument(node.node, input), { input });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to save position', ['NODE_WRITE_CONFLICT']) });
    }
  },

  deleteEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const edgeId = String(fd.get('edgeId') ?? '');
    if (!edgeId) return fail(400, { error: 'edgeId is required' });
    try {
      await client.request(DELETE_EDGE_MUTATION, { edgeRef: edgeId });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to delete edge') });
    }
  },
};
