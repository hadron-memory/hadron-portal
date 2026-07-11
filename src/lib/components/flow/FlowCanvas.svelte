<script lang="ts">
  import { onMount } from 'svelte';
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
  import ELK from 'elkjs/lib/elk.bundled.js';
  import { t } from '$lib/i18n/t';
  import type { FlowCanvasEdge, FlowCanvasModel, FlowCanvasNode } from '$lib/flow/canvas';
  import FlowNodeCard from './FlowNodeCard.svelte';

  let {
    model,
    focusId,
    basePath,
    height,
    selectedEdgeId = null,
    onEdgeSelect,
    onConnect,
  }: {
    model: FlowCanvasModel;
    focusId: string;
    basePath: string;
    height: number;
    /** Highlighted edge (the side panel's selection); null = none. */
    selectedEdgeId?: string | null;
    /** Edge click → id, pane click → null. Omit for a read-only canvas. */
    onEdgeSelect?: (edgeId: string | null) => void;
    /** Drag-to-connect completed. Omit to keep handles non-connectable. */
    onConnect?: (sourceId: string, targetId: string) => void;
  } = $props();

  const nodeTypes = { flow: FlowNodeCard };

  const NODE_WIDTH = 240;
  // Rough card height for ELK: header + one row per badge group. Svelte Flow
  // re-measures after mount, so this only shapes the initial layout.
  function nodeHeight(n: FlowCanvasNode): number {
    let h = 58;
    if (n.extractionFields.length > 0) h += 26 * Math.ceil(n.extractionFields.length / 2);
    if (n.tools.length > 0) h += 26 * n.tools.length;
    if (n.outputWriteTo) h += 26;
    return h;
  }

  function edgeLabel(e: FlowCanvasEdge): string {
    if (e.kind === 'reference') return e.label;
    const cond = e.conditionText ?? (e.isFallThrough ? t('flow.edge.always', 'always') : '');
    const prefix = e.isUnreachable ? `${t('flow.edge.unreachable', '⚠ unreachable')} · ` : '';
    return `${prefix}${e.position}. ${e.label}${cond ? ` — ${cond}` : ''}`;
  }

  function toEdge(e: FlowCanvasEdge, selectedId: string | null): Edge {
    const routing = e.kind === 'routing';
    const stroke = routing
      ? e.isUnreachable
        ? 'stroke: #f87171; stroke-dasharray: 6 3; opacity: 0.6;'
        : 'stroke: #6366f1;'
      : 'stroke: #a1a1aa; stroke-dasharray: 4 4; opacity: 0.7;';
    const selected = e.id === selectedId ? ' stroke-width: 3;' : '';
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      label: edgeLabel(e),
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: routing && !e.isUnreachable,
      style: stroke + selected,
      labelStyle: 'font-size: 10px;',
    };
  }

  function toNode(n: FlowCanvasNode, position: { x: number; y: number }): Node {
    return {
      id: n.id,
      type: 'flow',
      position,
      data: {
        name: n.name,
        loc: n.loc,
        kind: n.kind,
        isEntry: n.isEntry,
        isFocus: n.id === focusId,
        extractionFields: n.extractionFields,
        tools: n.tools,
        outputWriteTo: n.outputWriteTo,
        href: `${basePath}/nodes/${n.id}`,
      },
    };
  }

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let ready = $state(false);
  // Last model the canvas was synced from — plain (not $state): the sync
  // effect reads AND writes it, so tracking it would double-run the effect.
  let lastModel: FlowCanvasModel | null = null;

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

  onMount(async () => {
    // A layout failure must not strand the page on the loading state —
    // fall back to a simple grid and render anyway.
    let positions = new Map<string, { x: number; y: number }>();
    try {
      const elk = new ELK();
      const layout = await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.layered.spacing.nodeNodeBetweenLayers': '140',
          'elk.spacing.nodeNode': '48',
        },
        children: model.nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: nodeHeight(n) })),
        edges: model.edges.map((e) => ({ id: e.id, sources: [e.sourceId], targets: [e.targetId] })),
      });
      positions = new Map((layout.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
    } catch (err) {
      console.error('[flow-canvas] ELK layout failed; using grid fallback:', err);
      model.nodes.forEach((n, i) => {
        positions.set(n.id, { x: (i % 4) * (NODE_WIDTH + 60), y: Math.floor(i / 4) * 180 });
      });
    }

    nodes = model.nodes.map((n) => toNode(n, positions.get(n.id) ?? { x: 0, y: 0 }));
    edges = model.edges.map((e) => toEdge(e, selectedEdgeId));
    lastModel = model;
    ready = true;
  });

  // Re-sync after the initial layout when the model changes (a save/create
  // invalidated the load) or the selection highlight moves — WITHOUT
  // re-running elk, so node positions (including user drags) survive. Nodes
  // the previous model didn't have fall back to a grid slot.
  $effect(() => {
    const m = model;
    const sel = selectedEdgeId;
    if (!ready) return;
    if (m !== lastModel) {
      lastModel = m;
      const prev = new Map(nodes.map((n) => [n.id, n.position]));
      nodes = m.nodes.map((n, i) =>
        toNode(n, prev.get(n.id) ?? { x: (i % 4) * (NODE_WIDTH + 60), y: Math.floor(i / 4) * 180 }),
      );
    }
    edges = m.edges.map((e) => toEdge(e, sel));
  });
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
      onedgeclick={({ edge }) => onEdgeSelect?.(edge.id)}
      onpaneclick={() => onEdgeSelect?.(null)}
      onconnect={(connection) => onConnect?.(connection.source, connection.target)}
    >
      <Background />
      <Controls />
      <MiniMap />
    </SvelteFlow>
  {:else}
    <div class="flex h-full items-center justify-center text-sm text-zinc-400">
      {t('flow.canvas.layingOut', 'Laying out flow…')}
    </div>
  {/if}
</div>
