<script lang="ts">
  import type { MemoryNode } from '$lib/types';

  type GraphNode = {
    id: string;
    loc: string;
    name: string;
    type: 'topic' | 'conversation' | 'stage';
    x: number;
    y: number;
    data: Record<string, unknown>;
    description?: string | null;
  };

  type GraphEdge = {
    id: string;
    sourceId: string;
    targetId: string;
    label: string;
    data: Record<string, unknown>;
  };

  let {
    nodes: rawNodes,
    edges: rawEdges = [],
    selectedNodeId = $bindable<string | null>(null),
    onselect,
  }: {
    nodes: MemoryNode[];
    edges?: Array<{ id: string; sourceId: string; targetId: string; label: string; data?: Record<string, unknown> }>;
    selectedNodeId?: string | null;
    onselect?: (node: GraphNode) => void;
  } = $props();

  // Convert raw nodes into positioned graph nodes
  const graphNodes = $derived.by(() => {
    const result: GraphNode[] = [];
    const topics: MemoryNode[] = [];
    const conversations: MemoryNode[] = [];
    const stagesByConv: Record<string, MemoryNode[]> = {};

    for (const n of rawNodes) {
      if (n.loc.startsWith('topics:') && n.loc.split(':').length === 2) {
        topics.push(n);
      } else if (n.loc.startsWith('conversations:') && n.loc.split(':').length === 2) {
        conversations.push(n);
      } else if (n.loc.startsWith('conversations:') && n.loc.split(':').length === 3) {
        const convLoc = n.loc.split(':').slice(0, 2).join(':');
        if (!stagesByConv[convLoc]) stagesByConv[convLoc] = [];
        stagesByConv[convLoc].push(n);
      }
    }

    // Use saved positions from node data, or auto-layout
    const posKey = (n: MemoryNode) => {
      const d = (n.data as Record<string, unknown>) ?? {};
      const pos = d.position as { x: number; y: number } | undefined;
      return pos;
    };

    // Auto-layout: topics on the left, conversations in the middle, stages on the right
    let topicY = 40;
    for (const t of topics) {
      const pos = posKey(t);
      result.push({
        id: t.id,
        loc: t.loc,
        name: t.name,
        type: 'topic',
        x: pos?.x ?? 60,
        y: pos?.y ?? topicY,
        data: (t.data as Record<string, unknown>) ?? {},
        description: t.description,
      });
      topicY += 100;
    }

    let convY = 40;
    for (const c of conversations) {
      const d = (c.data as Record<string, unknown>) ?? {};
      if (d.isSetup === true || d.isFallback === true) continue;
      const pos = posKey(c);
      result.push({
        id: c.id,
        loc: c.loc,
        name: c.name,
        type: 'conversation',
        x: pos?.x ?? 260,
        y: pos?.y ?? convY,
        data: d,
        description: c.description,
      });

      // Layout stages for this conversation
      const stages = stagesByConv[c.loc] ?? [];
      const stageOrder = (d.stageOrder as string[]) ?? [];
      const sortedStages = stageOrder
        .map((s) => stages.find((st) => st.loc.endsWith(`:${s}`)))
        .filter(Boolean) as MemoryNode[];
      // Add any unordered stages at the end
      for (const st of stages) {
        if (!sortedStages.includes(st)) sortedStages.push(st);
      }

      let stageY = convY - ((sortedStages.length - 1) * 50) / 2;
      for (const st of sortedStages) {
        const sPos = posKey(st);
        result.push({
          id: st.id,
          loc: st.loc,
          name: st.name,
          type: 'stage',
          x: sPos?.x ?? 500,
          y: sPos?.y ?? stageY,
          data: (st.data as Record<string, unknown>) ?? {},
          description: st.description,
        });
        stageY += 50;
      }
      convY += Math.max(sortedStages.length * 50 + 30, 100);
    }

    return result;
  });

  // Convert edges with graph node positions for rendering
  const graphEdges = $derived.by(() => {
    const nodeMap = new Map(graphNodes.map((n) => [n.id, n]));
    return rawEdges
      .map((e) => {
        const source = nodeMap.get(e.sourceId);
        const target = nodeMap.get(e.targetId);
        if (!source || !target) return null;
        return { ...e, source, target, data: e.data ?? {} };
      })
      .filter(Boolean) as Array<GraphEdge & { source: GraphNode; target: GraphNode }>;
  });

  // SVG viewport
  const viewBox = $derived.by(() => {
    if (graphNodes.length === 0) return '0 0 700 300';
    const xs = graphNodes.map((n) => n.x);
    const ys = graphNodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80;
    const minY = Math.min(...ys) - 40;
    const maxX = Math.max(...xs) + 180;
    const maxY = Math.max(...ys) + 60;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  });

  // Node dimensions by type
  function nodeWidth(type: string): number {
    return type === 'topic' ? 160 : type === 'conversation' ? 140 : 110;
  }
  function nodeHeight(type: string): number {
    return type === 'topic' ? 44 : type === 'conversation' ? 38 : 30;
  }

  function nodeColor(type: string): string {
    return type === 'topic'
      ? '#3b82f6'  // blue
      : type === 'conversation'
        ? '#f59e0b'  // amber
        : '#6b7280';  // gray
  }

  function nodeFill(type: string, isSelected: boolean): string {
    if (isSelected) return type === 'topic' ? '#1d4ed8' : type === 'conversation' ? '#d97706' : '#4b5563';
    return type === 'topic' ? '#dbeafe' : type === 'conversation' ? '#fef3c7' : '#f3f4f6';
  }

  function darkNodeFill(type: string, isSelected: boolean): string {
    if (isSelected) return type === 'topic' ? '#1e40af' : type === 'conversation' ? '#92400e' : '#374151';
    return type === 'topic' ? '#1e3a5f' : type === 'conversation' ? '#451a03' : '#1f2937';
  }

  function handleNodeClick(node: GraphNode) {
    selectedNodeId = node.id;
    onselect?.(node);
  }

  // Edge path: straight line with a slight curve
  function edgePath(source: GraphNode, target: GraphNode): string {
    const sw = nodeWidth(source.type);
    const th = nodeHeight(target.type);
    const sx = source.x + sw;
    const sy = source.y + nodeHeight(source.type) / 2;
    const tx = target.x;
    const ty = target.y + th / 2;
    const midX = (sx + tx) / 2;
    return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`;
  }

  function edgeIsDashed(data: Record<string, unknown>): boolean {
    return data.behavior === 'detour';
  }
</script>

{#if graphNodes.length === 0}
  <div class="flex items-center justify-center py-12 text-sm text-zinc-500">
    No conversations to display. Create one in the conversation editor.
  </div>
{:else}
  <svg viewBox={viewBox} class="w-full" style="min-height: 300px; max-height: 600px;">
    <!-- Defs for arrowhead -->
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
      </marker>
      <marker id="arrowhead-detour" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
      </marker>
    </defs>

    <!-- Edges -->
    {#each graphEdges as edge (edge.id)}
      <path
        d={edgePath(edge.source, edge.target)}
        fill="none"
        stroke={edgeIsDashed(edge.data) ? '#f59e0b' : '#9ca3af'}
        stroke-width="1.5"
        stroke-dasharray={edgeIsDashed(edge.data) ? '6,3' : 'none'}
        marker-end={edgeIsDashed(edge.data) ? 'url(#arrowhead-detour)' : 'url(#arrowhead)'}
      />
      <!-- Edge label -->
      {#if edge.label}
        {@const midX = (edge.source.x + nodeWidth(edge.source.type) + edge.target.x) / 2}
        {@const midY = (edge.source.y + nodeHeight(edge.source.type) / 2 + edge.target.y + nodeHeight(edge.target.type) / 2) / 2}
        <text x={midX} y={midY - 6} text-anchor="middle" class="fill-zinc-400 text-[9px]">
          {edge.label.length > 30 ? edge.label.slice(0, 28) + '...' : edge.label}
        </text>
      {/if}
    {/each}

    <!-- Stage-to-stage flow arrows (within conversations) -->
    {#each graphNodes.filter(n => n.type === 'conversation') as conv}
      {@const stageOrder = Array.isArray(conv.data.stageOrder) ? conv.data.stageOrder : []}
      {#each stageOrder as stageName, i}
        {#if i < stageOrder.length - 1}
          {@const fromStage = graphNodes.find(n => n.loc === `${conv.loc}:${stageName}`)}
          {@const toStage = graphNodes.find(n => n.loc === `${conv.loc}:${stageOrder[i + 1]}`)}
          {#if fromStage && toStage}
            <line
              x1={fromStage.x + nodeWidth('stage') / 2}
              y1={fromStage.y + nodeHeight('stage')}
              x2={toStage.x + nodeWidth('stage') / 2}
              y2={toStage.y}
              stroke="#d1d5db"
              stroke-width="1"
              stroke-dasharray="3,3"
              marker-end="url(#arrowhead)"
            />
          {/if}
        {/if}
      {/each}
    {/each}

    <!-- Conversation-to-stages connector -->
    {#each graphNodes.filter(n => n.type === 'conversation') as conv}
      {@const firstStageName = Array.isArray(conv.data.stageOrder) ? conv.data.stageOrder[0] : null}
      {#if firstStageName}
        {@const firstStage = graphNodes.find(n => n.loc === `${conv.loc}:${firstStageName}`)}
        {#if firstStage}
          <line
            x1={conv.x + nodeWidth('conversation')}
            y1={conv.y + nodeHeight('conversation') / 2}
            x2={firstStage.x}
            y2={firstStage.y + nodeHeight('stage') / 2}
            stroke="#e5e7eb"
            stroke-width="1"
          />
        {/if}
      {/if}
    {/each}

    <!-- Nodes -->
    {#each graphNodes as node (node.id)}
      {@const w = nodeWidth(node.type)}
      {@const h = nodeHeight(node.type)}
      {@const isSelected = selectedNodeId === node.id}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <g
        class="cursor-pointer"
        onclick={() => handleNodeClick(node)}
      >
        <!-- Glow effect for selected node -->
        {#if isSelected}
          <rect
            x={node.x - 3} y={node.y - 3}
            width={w + 6} height={h + 6}
            rx={node.type === 'topic' ? 10 : 6}
            fill="none"
            stroke={nodeColor(node.type)}
            stroke-width="2"
            opacity="0.4"
          />
        {/if}

        <!-- Node rect -->
        <rect
          x={node.x} y={node.y}
          width={w} height={h}
          rx={node.type === 'topic' ? 8 : 5}
          fill={nodeFill(node.type, isSelected)}
          stroke={nodeColor(node.type)}
          stroke-width={isSelected ? 2 : 1}
          class="dark:hidden"
        />
        <rect
          x={node.x} y={node.y}
          width={w} height={h}
          rx={node.type === 'topic' ? 8 : 5}
          fill={darkNodeFill(node.type, isSelected)}
          stroke={nodeColor(node.type)}
          stroke-width={isSelected ? 2 : 1}
          class="hidden dark:block"
        />

        <!-- Node label -->
        <text
          x={node.x + w / 2} y={node.y + h / 2 + 1}
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-zinc-800 dark:fill-zinc-200"
          font-size={node.type === 'topic' ? 12 : node.type === 'conversation' ? 11 : 10}
          font-weight={node.type === 'stage' ? 'normal' : '600'}
        >
          {node.name.length > 16 ? node.name.slice(0, 14) + '...' : node.name}
        </text>

        <!-- Type indicator (small) -->
        {#if node.type === 'topic'}
          <text x={node.x + 6} y={node.y + 10} class="fill-blue-500" font-size="7">TOPIC</text>
        {/if}
      </g>
    {/each}
  </svg>
{/if}
