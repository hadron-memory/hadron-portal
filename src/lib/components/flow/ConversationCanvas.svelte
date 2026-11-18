<script lang="ts">
  import {
    Background,
    Controls,
    MarkerType,
    MiniMap,
    SvelteFlow,
    type ColorMode,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { onMount, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import type {
    ConversationCanvasEdge,
    ConversationCanvasModel,
    ConversationCanvasNode,
  } from '$lib/flow/conversation-canvas';
  import ConversationGroupCard from './ConversationGroupCard.svelte';
  import ConversationNodeCard from './ConversationNodeCard.svelte';

  let {
    model,
    height,
    selectedId = null,
    onSelect,
    onConnect,
    onNodeMoved,
  }: {
    model: ConversationCanvasModel;
    height: number;
    /** Selected node OR rule-edge id (the side panel's subject); null = none. */
    selectedId?: string | null;
    /** Node/edge click → id, pane click → null. */
    onSelect?: (id: string | null) => void;
    /** Drag-to-connect completed. Omit to keep handles non-connectable. */
    onConnect?: (sourceId: string, targetId: string) => void;
    /** A node was dragged; position is parent-relative for stages. */
    onNodeMoved?: (id: string, x: number, y: number) => void;
  } = $props();

  const nodeTypes = { conversationGroup: ConversationGroupCard, conversationCard: ConversationNodeCard };

  function edgeLabel(e: ConversationCanvasEdge): string {
    if (e.kind === 'sequence') return '';
    const parts: string[] = [];
    if (e.position != null) parts.push(`${e.position}.`);
    parts.push(e.label || t('conversation.edge.unnamed', 'rule'));
    if (e.isDetour) parts.push(`(${t('conversation.edge.detour', 'detour')})`);
    if (e.conditionText) parts.push(`— ${e.conditionText}`);
    if (e.timing && e.timing !== 'on_complete') parts.push(`· ${e.timing}`);
    return parts.join(' ');
  }

  function toEdge(e: ConversationCanvasEdge, selected: string | null): Edge {
    const isSequence = e.kind === 'sequence';
    const stroke = isSequence
      ? 'stroke: #a1a1aa; stroke-dasharray: 4 4; opacity: 0.6;'
      : e.isDetour
        ? 'stroke: #f59e0b; stroke-dasharray: 6 3;'
        : 'stroke: #6366f1;';
    const highlight = e.id === selected ? ' stroke-width: 3;' : '';
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      label: edgeLabel(e),
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: e.kind === 'rule' && !e.isDetour,
      selectable: !isSequence,
      style: stroke + highlight,
      labelStyle: 'font-size: 10px;',
      // Above the conversation groups' background, or edges between stages
      // inside a group would be painted over.
      zIndex: 1,
    };
  }

  function toNode(n: ConversationCanvasNode, position: { x: number; y: number }, selected: string | null): Node {
    const base = {
      id: n.id,
      position,
      width: n.width,
      height: n.height,
      data: {
        label: n.label,
        loc: n.loc,
        kind: n.kind,
        isSetup: n.isSetup,
        isFallback: n.isFallback,
        startOrder: n.startOrder,
        startTotal: n.startTotal,
        goalCount: n.goalCount,
        stageIndex: n.stageIndex,
        extractionFields: n.extractionFields,
        isSelected: n.id === selected,
      },
    };
    return n.kind === 'conversation'
      ? { ...base, type: 'conversationGroup' }
      : n.parentId
        ? { ...base, type: 'conversationCard', parentId: n.parentId, extent: 'parent' as const }
        : { ...base, type: 'conversationCard' };
  }

  const ruleEdgeIds = $derived(
    new Set(model.edges.filter((e) => e.kind === 'rule').map((e) => e.id)),
  );

  // Seeded synchronously (positions are deterministic — no async layout
  // pass), so SvelteFlow mounts with content and fitView has something to
  // fit; the sync effect below handles later model/selection changes
  // (untrack silences state_referenced_locally for the init-only reads).
  let nodes = $state.raw<Node[]>(
    untrack(() => model.nodes.map((n) => toNode(n, n.position, selectedId))),
  );
  let edges = $state.raw<Edge[]>(untrack(() => model.edges.map((e) => toEdge(e, selectedId))));
  // Last model the canvas was synced from — plain (not $state): the sync
  // effect reads AND writes it, so tracking it would double-run the effect.
  let lastModel: ConversationCanvasModel = untrack(() => model);

  // Mount SvelteFlow one frame late: during hydration the flex parent hasn't
  // been laid out yet, so fitView would measure a 0-width pane and clamp to
  // minZoom. (FlowCanvas gets this delay implicitly from awaiting elk.)
  let ready = $state(false);
  onMount(() => {
    const raf = requestAnimationFrame(() => (ready = true));
    return () => cancelAnimationFrame(raf);
  });

  // ssr = false on the route, so document is available at component init.
  // The root layout applies the .dark class after this component initializes,
  // so track the class instead of reading it once.
  let colorMode = $state<ColorMode>('dark');
  $effect(() => {
    const read = () =>
      (colorMode = document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  });

  // Resync on model change (a save invalidated the load) or selection move.
  // Positions the user dragged this session are preserved by id; sizes always
  // come from the fresh model so a group grows when a stage is added.
  // `nodes` is read via untrack: the effect writes it, so tracking it would
  // loop.
  $effect(() => {
    const m = model;
    const sel = selectedId;
    const current = untrack(() => nodes);
    if (m !== lastModel) {
      const prev = new Map(current.map((n) => [n.id, n.position]));
      lastModel = m;
      nodes = m.nodes.map((n) => toNode(n, prev.get(n.id) ?? n.position, sel));
    } else {
      nodes = current.map((n) => ({
        ...n,
        data: { ...n.data, isSelected: n.id === sel },
      }));
    }
    edges = m.edges.map((e) => toEdge(e, sel));
  });

  function handleDragStop(dragged: Node[]) {
    for (const n of dragged) {
      onNodeMoved?.(n.id, n.position.x, n.position.y);
    }
  }
</script>

<!-- Explicit px height: SvelteFlow's own height:100% resolves to 0 through the
     page's flex/min-height parent chain, so the page measures and passes px. -->
<div style="height: {height}px; width: 100%;">
  {#if ready}
    <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    {colorMode}
    fitView
    minZoom={0.15}
    nodesConnectable={!!onConnect}
    deleteKey={null}
    proOptions={{ hideAttribution: false }}
    onnodeclick={({ node }) => onSelect?.(node.id)}
    onedgeclick={({ edge }) => {
      if (ruleEdgeIds.has(edge.id)) onSelect?.(edge.id);
    }}
    onpaneclick={() => onSelect?.(null)}
    onnodedragstop={({ nodes: dragged }) => handleDragStop(dragged)}
    onbeforeconnect={(connection) => {
      // Returning null suppresses SvelteFlow's optimistic client-side edge
      // (added BEFORE onconnect would fire) — otherwise a failed addEdge
      // action would leave a phantom edge on the canvas. The real edge
      // arrives via invalidation after the action succeeds.
      onConnect?.(connection.source, connection.target);
      return null;
    }}
  >
      <Background />
      <Controls />
      <MiniMap />
    </SvelteFlow>
  {/if}
</div>
