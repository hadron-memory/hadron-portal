<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { GraphViewData, Topic } from "$lib/types";
  import { graphState } from "./GraphState.svelte.js";

  let { data, focusId, basePath }: { data: GraphViewData; focusId?: string; basePath: string } = $props();

  let graphContainer: HTMLDivElement;
  let selectedTopic: Topic | null = $state(null);
  let hierarchyVisible = $state(true);
  let physicsEnabled = $state(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let network: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodesDataset: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let edgesDataset: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let folderVisNodes: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hierEdges: any[] = [];

  const palette = [
    { bg: "#58a6ff", border: "#388bfd", font: "#0d1117" },
    { bg: "#3fb950", border: "#2ea043", font: "#0d1117" },
    { bg: "#d29922", border: "#bb8009", font: "#0d1117" },
    { bg: "#bc8cff", border: "#8b5cf6", font: "#0d1117" },
    { bg: "#f97583", border: "#ea4a5a", font: "#0d1117" },
    { bg: "#56d4dd", border: "#39c5cf", font: "#0d1117" },
  ];

  const allDomains = $derived([...new Set(data.topics.map((t) => t.domain))].sort());
  const domainColors = $derived.by(() => {
    const colors: Record<string, (typeof palette)[0]> = {};
    allDomains.forEach((d, i) => {
      colors[d] = palette[i % palette.length];
    });
    return colors;
  });

  function sizeForDepth(d: number) {
    return Math.max(14, 36 - d * 6);
  }

  function fontForDepth(d: number) {
    return Math.max(11, 16 - d * 1.5);
  }

  function incomingEdges(topic: Topic) {
    return data.topics.flatMap((t) =>
      t.nodes
        .filter((n) => n.loc === topic.id)
        .map((n) => ({ from: t.id, fromName: t.name, rel: n.rel }))
    );
  }

  function focusNode(nodeId: string) {
    const topic = data.topics.find((t) => t.id === nodeId);
    if (topic && network) {
      network.focus(nodeId, {
        scale: 1.2,
        animation: { duration: 500, easingFunction: "easeInOutQuad" },
      });
      network.selectNodes([nodeId]);
      selectedTopic = topic;
      graphState.selectedNodeId = topic.id;
    }
  }

  function toggleHierarchy() {
    hierarchyVisible = !hierarchyVisible;
    if (hierarchyVisible) {
      hierEdges.forEach((e: { id: string }) => {
        try { edgesDataset.add(e); } catch { /* already exists */ }
      });
      folderVisNodes.forEach((n: { id: string }) => {
        try { nodesDataset.add(n); } catch { /* already exists */ }
      });
    } else {
      hierEdges.forEach((e: { id: string }) => {
        try { edgesDataset.remove(e.id); } catch { /* not found */ }
      });
      folderVisNodes.forEach((n: { id: string }) => {
        try { nodesDataset.remove(n.id); } catch { /* not found */ }
      });
    }
  }

  function togglePhysics() {
    physicsEnabled = !physicsEnabled;
    network.setOptions({ physics: { enabled: physicsEnabled } });
  }

  onDestroy(() => {
    graphState.selectedNodeId = null;
    if (filterTimeout) clearTimeout(filterTimeout);
  });

  onMount(async () => {
    const vis = await import("vis-network/standalone");

    const visNodes = data.topics.map((t) => {
      const c = domainColors[t.domain];
      return {
        id: t.id,
        label: t.name,
        size: sizeForDepth(t.depth),
        shape: "dot",
        color: {
          background: c.bg,
          border: c.border,
          highlight: { background: c.bg, border: "#f0f6fc" },
          hover: { background: c.bg, border: "#f0f6fc" },
        },
        font: {
          color: "#c9d1d9",
          size: fontForDepth(t.depth),
          face: "-apple-system, BlinkMacSystemFont, sans-serif",
        },
        title: t.id + "\n" + t.description,
        borderWidth: 2,
        shadow: { enabled: true, color: "rgba(0,0,0,0.3)", size: 6, x: 2, y: 2 },
      };
    });

    folderVisNodes = data.folderNodes.map((f) => {
      const c = domainColors[f.domain];
      if (f.isDomain) {
        return {
          id: f.id, label: f.name, size: 20, shape: "diamond",
          color: { background: "#0d1117", border: c.bg, highlight: { background: "#161b22", border: "#f0f6fc" }, hover: { background: "#161b22", border: "#f0f6fc" } },
          font: { color: c.bg, size: 13, face: "-apple-system, BlinkMacSystemFont, sans-serif", bold: true },
          title: f.name + " (domain)", borderWidth: 2,
          shadow: { enabled: true, color: "rgba(0,0,0,0.3)", size: 6, x: 2, y: 2 },
        };
      }
      return {
        id: f.id, label: f.name, size: 10, shape: "square",
        color: { background: "#161b22", border: c.bg + "80", highlight: { background: "#1c2128", border: c.bg }, hover: { background: "#1c2128", border: c.bg } },
        font: { color: "#8b949e", size: 11, face: "-apple-system, BlinkMacSystemFont, sans-serif" },
        title: f.id + " (folder)", borderWidth: 1,
        shadow: { enabled: true, color: "rgba(0,0,0,0.2)", size: 4, x: 1, y: 1 },
      };
    });

    const relEdges = data.topics.flatMap((t) =>
      t.nodes.map((n) => ({
        from: t.id,
        to: n.loc,
        label: n.rel.length > 40 ? n.rel.substring(0, 37) + "..." : n.rel,
        title: n.rel,
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        color: { color: "#484f58", highlight: "#58a6ff", hover: "#58a6ff" },
        font: { color: "#8b949e", size: 11, face: "-apple-system, BlinkMacSystemFont, sans-serif", strokeWidth: 3, strokeColor: "#0d1117", align: "horizontal" as const },
        smooth: { type: "curvedCW" as const, roundness: 0.15 },
        width: 1.5, hoverWidth: 2.5,
      }))
    );

    hierEdges = data.hierEdges.map((e) => ({
      id: "hier_" + e.to, from: e.from, to: e.to,
      dashes: [6, 6],
      color: { color: "#21262d", highlight: "#30363d", hover: "#30363d" },
      width: 1, arrows: { to: { enabled: false } }, smooth: false,
    }));

    nodesDataset = new vis.DataSet([...visNodes, ...folderVisNodes]);
    edgesDataset = new vis.DataSet([...relEdges, ...hierEdges]);

    network = new vis.Network(
      graphContainer,
      { nodes: nodesDataset, edges: edgesDataset },
      {
        physics: {
          enabled: true, solver: "forceAtlas2Based",
          forceAtlas2Based: { gravitationalConstant: -80, centralGravity: 0.005, springLength: 200, springConstant: 0.03, damping: 0.4 },
          stabilization: { iterations: 300 },
        },
        interaction: { hover: true, tooltipDelay: 200, zoomView: true, dragView: true },
        edges: { selectionWidth: 2, scaling: { label: { drawThreshold: 2 } } },
      }
    );

    network.on("click", (params: { nodes: string[] }) => {
      if (params.nodes.length > 0) {
        const topic = data.topics.find((t) => t.id === params.nodes[0]);
        if (topic) {
          selectedTopic = topic;
          graphState.selectedNodeId = topic.id;
        }
      } else {
        selectedTopic = null;
        graphState.selectedNodeId = null;
      }
    });

    if (focusId) {
      network.once("stabilizationIterationsDone", () => {
        focusNode(focusId);
      });
    }

    // Store all node IDs for search filtering
    allTopicIds = data.topics.map((t) => t.id);
    allFolderIds = data.folderNodes.map((f) => f.id);
    graphReady = true;
  });

  let allTopicIds: string[] = [];
  let allFolderIds: string[] = [];
  let graphReady = $state(false);

  // React to search filter changes — show/hide nodes in the graph (debounced)
  let filterTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (!graphReady || !network || !nodesDataset) return;
    const raw = graphState.searchFilter;

    // Debounce: wait 300ms after last keystroke before updating the graph
    if (filterTimeout) clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      if (!network || !nodesDataset) return;
      const q = raw.toLowerCase().trim();

      if (!q) {
        // Show all nodes
        for (const id of allTopicIds) {
          try { nodesDataset.update({ id, hidden: false }); } catch {}
        }
        for (const id of allFolderIds) {
          try { nodesDataset.update({ id, hidden: !hierarchyVisible }); } catch {}
        }
        return;
      }

      // Filter: show only matching topics + their ancestors
      const matchingIds = new Set<string>();
      for (const t of data.topics) {
        if (t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)) {
          matchingIds.add(t.id);
          // Add ancestors
          const parts = t.id.split(':');
          for (let i = 1; i < parts.length; i++) {
            matchingIds.add(parts.slice(0, i).join(':'));
          }
        }
      }

      for (const id of allTopicIds) {
        try { nodesDataset.update({ id, hidden: !matchingIds.has(id) }); } catch {}
      }
      for (const id of allFolderIds) {
        try { nodesDataset.update({ id, hidden: !matchingIds.has(id) }); } catch {}
      }
    }, 300);
  });

</script>

<div class="graph-wrapper">
  <div class="toolbar">
    <div class="legend">
      {#each allDomains as domain}
        <div class="legend-item">
          <div class="legend-dot" style="background: {domainColors[domain].bg};"></div>
          {domain}
        </div>
      {/each}
      <span class="separator">|</span>
      <div class="legend-level">
        <div class="size-dot" style="width:20px;height:20px;"></div>
        shallow
        <div class="size-dot" style="width:12px;height:12px;"></div>
        deep
      </div>
    </div>
    <div class="controls">
      <button onclick={() => network?.fit()}>Fit</button>
    </div>
  </div>

  <div class="graph-container">
    <div bind:this={graphContainer} class="graph"></div>

    {#if selectedTopic}
      <div class="detail-panel">
        <button class="close-btn" onclick={() => (selectedTopic = null)}>&times;</button>
        <div class="detail-title-row">
          <h2>{selectedTopic.name}</h2>
          <a href="{basePath}/nodes/{encodeURIComponent(selectedTopic.id)}" class="open-link">Open</a>
        </div>
        <div class="loc">{selectedTopic.id}</div>
        <span class="domain-badge" style="background: {domainColors[selectedTopic.domain].bg}; color: {domainColors[selectedTopic.domain].font};">
          {selectedTopic.domain}
        </span>
        <div class="description">{selectedTopic.description}</div>
        {#if selectedTopic.tags.length > 0}
          <div class="tags">
            {#each selectedTopic.tags as tag}
              <span class="tag">{tag}</span>
            {/each}
          </div>
        {/if}
        {#if selectedTopic.nodes.length > 0}
          <div class="section-label">References</div>
          {#each selectedTopic.nodes as node}
            <div class="edge-row">
              <button class="edge-item" onclick={() => focusNode(node.loc)}>
                <div class="edge-loc">{node.loc}</div>
                <div class="edge-rel">{node.rel}</div>
              </button>
              <a href="{basePath}/nodes/{encodeURIComponent(node.loc)}" class="edge-open" title="Open node page">&#8599;</a>
            </div>
          {/each}
        {/if}
        {#if incomingEdges(selectedTopic).length > 0}
          <div class="section-label">Referenced By</div>
          {#each incomingEdges(selectedTopic) as edge}
            <div class="edge-row">
              <button class="edge-item" onclick={() => focusNode(edge.from)}>
                <div class="edge-loc">{edge.from}</div>
                <div class="edge-rel">{edge.rel}</div>
              </button>
              <a href="{basePath}/nodes/{encodeURIComponent(edge.from)}" class="edge-open" title="Open node page">&#8599;</a>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .graph-wrapper { flex: 1; display: flex; flex-direction: column; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 0; }
  .toolbar { padding: 8px 24px; background: #0d1117; border-bottom: 1px solid #21262d; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .legend { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; }
  .separator { color: #30363d; margin: 0 4px; }
  .legend-level { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #8b949e; }
  .legend-level .size-dot { border-radius: 50%; background: #8b949e; }
  .controls { margin-left: auto; display: flex; gap: 8px; }
  .controls button { padding: 4px 12px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; font-size: 13px; }
  .controls button:hover { background: #30363d; }
  .controls button.active { background: #1f6feb; border-color: #388bfd; }
  .graph-container { flex: 1; position: relative; min-height: 0; }
  .graph { width: 100%; height: 100%; }
  .detail-panel { position: absolute; top: 16px; right: 16px; width: 360px; max-height: calc(100% - 32px); overflow-y: auto; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; z-index: 10; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); }
  .detail-title-row { display: flex; align-items: center; gap: 8px; }
  .detail-panel h2 { font-size: 16px; color: #f0f6fc; margin-bottom: 4px; }
  .open-link { font-size: 12px; color: #58a6ff; text-decoration: none; padding: 2px 8px; border: 1px solid #30363d; border-radius: 4px; white-space: nowrap; flex-shrink: 0; }
  .open-link:hover { background: #21262d; border-color: #58a6ff; }
  .loc { font-size: 12px; color: #8b949e; font-family: monospace; margin-bottom: 12px; }
  .domain-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-bottom: 8px; }
  .description { font-size: 14px; line-height: 1.5; margin-bottom: 12px; }
  .section-label { font-size: 12px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 12px; margin-bottom: 6px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .tag { padding: 2px 8px; background: #21262d; border-radius: 12px; font-size: 11px; color: #8b949e; }
  .edge-row { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .edge-item { display: block; flex: 1; min-width: 0; padding: 8px; background: #0d1117; border: none; border-radius: 6px; cursor: pointer; text-align: left; color: inherit; }
  .edge-item:hover { background: #1c2128; }
  .edge-open { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; color: #8b949e; text-decoration: none; border-radius: 4px; font-size: 14px; }
  .edge-open:hover { color: #58a6ff; background: #21262d; }
  .edge-loc { font-size: 12px; font-family: monospace; color: #58a6ff; }
  .edge-rel { font-size: 13px; color: #8b949e; margin-top: 2px; }
  .close-btn { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #8b949e; cursor: pointer; font-size: 18px; padding: 4px; }
  .close-btn:hover { color: #f0f6fc; }
</style>
