<script lang="ts">
  // Diagnostic only: preload synthetic layout data, then mount the real component.
  // This is not the authenticated MemoryBrowser route or a performance fix.
  import { tick } from 'svelte';
  import TreeView from '$lib/components/TreeView.svelte';
  import type { TreeEntry, MemoryNode } from '$lib/types';
  import { buildTreeEntries } from '$lib/graph-utils';
  import { synthMemory } from '../../synth-memory';

  // MemoryBrowser builds fresh plain entries in $derived.by; do not add deep proxies.
  let entries = $state.raw<TreeEntry[]>([]);
  let visible = $state(false);
  let done = $state(false);
  function makeEntries(size: number, roots: number): TreeEntry[] {
    if (!Number.isInteger(roots) || roots < 1 || !Number.isInteger(size) || size < roots * 11) {
      throw new Error('Shape requires integer roots >= 1 and size >= roots * 11');
    }
    const result: TreeEntry[] = [];
    const add = (id: string) => result.push({ id, nodeId: `synthetic-${id}`, name: `Synthetic ${id}`, seq: null,
      nodeType: 'info', hasActions: false, isVirtual: false });
    const grandchildren = size - roots * 11;
    let childIndex = 0;
    for (let root = 0; root < roots; root++) {
      const rootId = `root${String(root).padStart(4, '0')}`;
      add(rootId);
      for (let child = 0; child < 10; child++, childIndex++) {
        const childId = `${rootId}:child${child}`;
        add(childId);
        const count = Math.floor(grandchildren / (roots * 10)) + (childIndex < grandchildren % (roots * 10) ? 1 : 0);
        for (let leaf = 0; leaf < count; leaf++) add(`${childId}:leaf${leaf}`);
      }
    }
    return result;
  }
  async function enter() {
    performance.mark('tree-entry-start');
    visible = true;
    await tick();
    // Two animation frames include a rendering opportunity after the Svelte flush.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    performance.mark('tree-entry-end');
    performance.measure('tree-entry', 'tree-entry-start', 'tree-entry-end');
    done = true;
  }
  // The runner calls this before tracing/clicking; no data/network work is timed.
  (window as any).prepareTree = async (size: number, roots: number) => {
    visible = false;
    done = false;
    let generated: TreeEntry[];
    if (roots === 0) {
      // Same default shape and seed=1380 as the layout-entry diagnostic.
      const world = synthMemory(size);
      generated = buildTreeEntries(world.nodes as unknown as MemoryNode[], world.memory.urn);
    } else generated = makeEntries(size, roots);
    // These colon-delimited ids match TreeView default expansion: top-level roots
    // are expanded, so only roots and their immediate children are initially visible.
    const expectedRows = generated.filter((e) => e.id.split(':').length <= 2).length;
    entries = generated;
    await tick();
    return { inputNodes: size, entries: generated.length, expectedRows };
  };
</script>

<main>
  <h1>Synthetic cached-layout tree entry</h1>
  <button onclick={enter} disabled={visible}>Enter Tree</button>
  <span data-done={done}>{done ? 'Ready' : 'Layout data ready'}</span>
  <div class="pane">{#if visible}<TreeView {entries} basePath="/app/memories/synthetic" />{/if}</div>
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, sans-serif; }
  main { padding: 24px; }
  .pane { height: 720px; width: 1000px; overflow: auto; border: 1px solid #aaa; margin-top: 16px; }
</style>
