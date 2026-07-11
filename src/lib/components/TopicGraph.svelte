<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { GraphViewData, Topic } from "$lib/types";
  import Urn from "./Urn.svelte";
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
        .map((n) => ({ id: n.id, from: t.id, fromName: t.name, rel: n.rel }))
    );
  }

  // Merged edge list for the popup "Edges" section: the selected node's
  // outgoing + incoming edges, each carrying the edge id (for the
  // hrn:edge:<id> URN), its label, direction, and the connected node's id
  // (used to focus it in the graph and to build the "Open" link).
  type PopupEdge = { edgeId: string; label: string; dir: 'out' | 'in'; nodeId: string };
  const popupEdges = $derived.by<PopupEdge[]>(() => {
    const t = selectedTopic;
    if (!t) return [];
    const out: PopupEdge[] = t.nodes.map((n) => ({ edgeId: n.id, label: n.rel, dir: 'out', nodeId: n.loc }));
    const inc: PopupEdge[] = incomingEdges(t).map((e) => ({ edgeId: e.id, label: e.rel, dir: 'in', nodeId: e.from }));
    return [...out, ...inc];
  });

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

    const defaultColor = palette[0];
    const readOnlyColor = { bg: "#8b949e", border: "#6e7681", font: "#0d1117" };

    const visNodes = data.topics.map((t) => {
      const c = t.readOnly ? readOnlyColor : (domainColors[t.domain] ?? defaultColor);
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
          color: t.readOnly ? "#8b949e" : "#c9d1d9",
          size: fontForDepth(t.depth),
          face: "-apple-system, BlinkMacSystemFont, sans-serif",
        },
        title: t.name + (t.readOnly ? " (read-only)" : "") + "\n" + t.description,
        borderWidth: 2,
        shadow: { enabled: true, color: "rgba(0,0,0,0.3)", size: 6, x: 2, y: 2 },
      };
    });

    folderVisNodes = data.folderNodes.map((f) => {
      const c = domainColors[f.domain] ?? defaultColor;
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

    network.once("stabilizationIterationsDone", () => {
      // Freeze the layout once it has settled. forceAtlas2 keeps nudging nodes
      // after stabilization, so without this a focused node (from a graph or
      // tree click) drifts back out of view moments after centering (#349).
      network.setOptions({ physics: { enabled: false } });
      physicsEnabled = false;
      if (focusId) {
        focusNode(focusId);
      } else {
        network.fit({ animation: { duration: 300 } });
      }
    });

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
    // #531: node PKs matched by the server content search (name + tags +
    // description + body), or null for a plain (no-server-search) filter. Read
    // here so the effect re-runs when the result set arrives.
    const resultNodeIds = graphState.searchResultNodeIds;

    // Debounce: wait 300ms after last keystroke before updating the graph
    if (filterTimeout) clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      if (!network || !nodesDataset) return;
      const q = raw.toLowerCase().trim();

      if (!resultNodeIds && !q) {
        // Show all nodes
        for (const id of allTopicIds) {
          try { nodesDataset.update({ id, hidden: false }); } catch {}
        }
        for (const id of allFolderIds) {
          try { nodesDataset.update({ id, hidden: !hierarchyVisible }); } catch {}
        }
        return;
      }

      // Filter: show only matching topics and related folders. #531: prefer the
      // server content-search hits so a tag/body-only match shows in the graph
      // too; fall back to the local name/description match. Topic.id IS the node
      // PK (buildGraphViewData), so it matches searchResultNodeIds directly.
      const matchingTopicIds = new Set<string>();
      for (const t of data.topics) {
        const hit = resultNodeIds
          ? resultNodeIds.has(t.id)
          : t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q);
        if (hit) matchingTopicIds.add(t.id);
      }

      // Show all folder nodes if any topic matches (folders don't have searchable content)
      const showFolders = matchingTopicIds.size > 0;

      for (const id of allTopicIds) {
        try { nodesDataset.update({ id, hidden: !matchingTopicIds.has(id) }); } catch {}
      }
      for (const id of allFolderIds) {
        try { nodesDataset.update({ id, hidden: !showFolders }); } catch {}
      }
    }, 300);
  });

  // Drive selection from the shared graphState so a click on a row in the tree
  // sidebar (which sets graphState.selectedNodeId) focuses the node and opens
  // its popup — making a tree click equivalent to clicking the node in the
  // graph (#349). A direct graph click sets selectedTopic itself, so its id
  // already matches here and we skip re-focusing (graph clicks don't recenter).
  $effect(() => {
    const id = graphState.selectedNodeId;
    if (!graphReady || !network) return;
    // Skip only when an actually-selected node already matches (a direct graph
    // click sets selectedTopic itself, so we don't recenter it). The `id !==
    // null` guard is load-bearing: when id is null we must fall through to
    // clear + unselectAll — closing via × sets both id and selectedTopic null,
    // and coercing the undefined `selectedTopic?.id` to null would wrongly
    // short-circuit, leaving the node highlighted on the canvas (#351 review).
    if (id !== null && id === selectedTopic?.id) return;
    if (id == null) {
      selectedTopic = null;
      try { network.unselectAll(); } catch { /* network torn down */ }
      return;
    }
    // focusNode centers, selects, and sets selectedTopic + graphState.
    focusNode(id);
  });

</script>

<div class="graph-wrapper">
  <div class="toolbar">
    <div class="controls">
      <button onclick={() => network?.fit()}>Fit</button>
    </div>
  </div>

  <div class="graph-container">
    <div bind:this={graphContainer} class="graph"></div>

    {#if selectedTopic}
      <div class="detail-panel">
        <button class="close-btn" onclick={() => { selectedTopic = null; graphState.selectedNodeId = null; }}>&times;</button>
        <div class="detail-title-row">
          <h2>{selectedTopic.name}</h2>
          {#if basePath}
            <a href="{basePath}/nodes/{selectedTopic.id}" class="open-link">Open</a>
          {/if}
        </div>
        <div class="loc"><Urn value={selectedTopic.urn} type="node" size={10} /></div>
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
        {#if popupEdges.length > 0}
          <div class="section-label">Edges</div>
          {#each popupEdges as edge (edge.dir + ':' + edge.edgeId)}
            <div class="edge-card">
              <button class="edge-main" onclick={() => focusNode(edge.nodeId)} title="Focus the connected node in the graph">
                {#if edge.label}
                  <div class="edge-label">{edge.label}</div>
                {/if}
                <div class="edge-urn" title={`hrn:edge:${edge.edgeId}`}>
                  <span class="edge-dir" title={edge.dir === 'out' ? 'outgoing edge' : 'incoming edge'}>{edge.dir === 'out' ? '→' : '←'}</span>hrn:edge:{edge.edgeId}
                </div>
              </button>
              {#if basePath}
                <a href="{basePath}/nodes/{edge.nodeId}" class="open-link">Open</a>
              {/if}
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
  .edge-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px; margin-bottom: 6px; background: #0d1117; border-radius: 6px; }
  .edge-main { display: block; width: 100%; min-width: 0; padding: 0; background: none; border: none; cursor: pointer; text-align: left; color: inherit; }
  .edge-label { font-size: 13px; color: #c9d1d9; margin-bottom: 2px; }
  .edge-urn { font-size: 12px; font-family: monospace; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .edge-main:hover .edge-urn { color: #58a6ff; }
  .edge-dir { color: #58a6ff; margin-right: 4px; }
  .close-btn { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #8b949e; cursor: pointer; font-size: 18px; padding: 4px; }
  .close-btn:hover { color: #f0f6fc; }
</style>
