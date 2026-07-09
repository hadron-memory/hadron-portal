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
  import type { FlowCanvasEdge, FlowCanvasModel, FlowCanvasNode } from '$lib/flow/canvas';
  import FlowNodeCard from './FlowNodeCard.svelte';

  let {
    model,
    focusId,
    basePath,
    height,
  }: { model: FlowCanvasModel; focusId: string; basePath: string; height: number } = $props();

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
    const cond = e.conditionText ?? (e.isFallThrough ? 'always' : '');
    const prefix = e.isUnreachable ? '⚠ unreachable · ' : '';
    return `${prefix}${e.position}. ${e.label}${cond ? ` — ${cond}` : ''}`;
  }

  function toEdge(e: FlowCanvasEdge): Edge {
    const routing = e.kind === 'routing';
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      label: edgeLabel(e),
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: routing && !e.isUnreachable,
      style: routing
        ? e.isUnreachable
          ? 'stroke: #f87171; stroke-dasharray: 6 3; opacity: 0.6;'
          : 'stroke: #6366f1;'
        : 'stroke: #a1a1aa; stroke-dasharray: 4 4; opacity: 0.7;',
      labelStyle: 'font-size: 10px;',
    };
  }

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let ready = $state(false);

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
    const positions = new Map((layout.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));

    nodes = model.nodes.map((n) => ({
      id: n.id,
      type: 'flow',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
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
    }));
    edges = model.edges.map(toEdge);
    ready = true;
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
      nodesConnectable={false}
      proOptions={{ hideAttribution: false }}
    >
      <Background />
      <Controls />
      <MiniMap />
    </SvelteFlow>
  {:else}
    <div class="flex h-full items-center justify-center text-sm text-zinc-400">Laying out flow…</div>
  {/if}
</div>
