<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import DOMPurify from 'dompurify';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import NodeList from '$lib/components/NodeList.svelte';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { cleanLocInput } from '$lib/urn/clean-loc-input';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data.node);
  const basePath = $derived(`/app/memories/${data.graph.id}`);
  // #260: link the section crumb to the owning org's memories list only when
  // the user is a member (org present); otherwise render it as plain text.
  const memoriesHref = $derived(data.org ? `/app/orgs/${data.org.id}/memories` : undefined);

  // Full URN composed via the canonical composer. The startsWith() check
  // defends against legacy data where a node's stored loc already had its
  // memory URN baked in — strip it before composing so we don't duplicate.
  // Falls back to bare loc if the memory URN is missing — composeNodeUrn
  // would throw, and a node-detail page shouldn't crash because of an
  // upstream data-shape change.
  // R-2 (2026-05-06): also guard empty loc, which the prefix-strip
  // above can produce when a stored loc equals the memory URN exactly.
  const fullUrn = $derived.by(() => {
    let loc = node.loc;
    if (data.graph.urn && loc.startsWith(data.graph.urn + ':')) {
      loc = loc.slice(data.graph.urn.length + 1);
    }
    return data.graph.urn && loc ? composeNodeUrn(data.graph.urn, loc) : loc;
  });

  let showSource = $state(false);
  let confirmDelete = $state(false);
  let copied = $state(false);
  let isEditing = $state(false);

  // Inline editing
  let editContent = $state('');
  let saving = $state(false);

  $effect(() => {
    editContent = node.content ?? '';
  });

  async function saveContent() {
    saving = true;
    try {
      const fd = new FormData();
      fd.set('content', editContent);
      const res = await fetch('?/updateContent', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Save failed');
      await invalidateAll();
      showSource = false;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      saving = false;
    }
  }

  // Abstract — paragraph-length summary, the default vector-index source
  // (spec 031/033). Edited inline here exactly like content. The Abstract
  // tab is ALWAYS shown: an empty abstract still needs an authoring surface,
  // or there is no portal path to populate the index's default source. (The
  // Content tab is now always shown for the same reason — issue #256.)
  const ABSTRACT_MAX = 2000;
  let showAbstractSource = $state(false);
  let copiedAbstract = $state(false);
  let editAbstract = $state('');
  let savingAbstract = $state(false);

  $effect(() => {
    editAbstract = node.abstract ?? '';
  });

  async function saveAbstract() {
    savingAbstract = true;
    try {
      const fd = new FormData();
      fd.set('abstract', editAbstract);
      const res = await fetch('?/updateAbstract', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Save failed');
      await invalidateAll();
      showAbstractSource = false;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      savingAbstract = false;
    }
  }

  // Markdown rendering
  let renderedHtml = $state('');
  let markedReady = $state(false);
  let MarkedClass: typeof import('marked').Marked | null = null;

  onMount(async () => {
    MarkedClass = (await import('marked')).Marked;
    markedReady = true;
  });

  // Shared renderer for both content and abstract. The Marked instance is
  // cached once MarkedClass loads (its renderer config is static) so we
  // don't reinstantiate per render. Portal Invariant P4: markdown → HTML →
  // DOMPurify before insertion — escaping raw-HTML tokens alone leaves
  // anchor-based vectors (e.g. javascript: URLs) through.
  let markedInstance: import('marked').Marked | null = null;
  function renderMarkdown(src: string): string {
    if (!MarkedClass) return '';
    if (!markedInstance) {
      markedInstance = new MarkedClass({
        renderer: {
          html(token: { text: string }) {
            return token.text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
        },
      });
    }
    return DOMPurify.sanitize(markedInstance.parse(src, { async: false }) as string);
  }

  let renderedAbstractHtml = $state('');

  $effect(() => {
    renderedHtml = markedReady && node.content ? renderMarkdown(node.content) : '';
  });

  $effect(() => {
    renderedAbstractHtml = markedReady && node.abstract ? renderMarkdown(node.abstract) : '';
  });

  async function copyContent() {
    if (!node.content) return;
    try {
      await navigator.clipboard.writeText(node.content);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* no-op */ }
  }

  async function copyAbstract() {
    if (!node.abstract) return;
    try {
      await navigator.clipboard.writeText(node.abstract);
      copiedAbstract = true;
      setTimeout(() => (copiedAbstract = false), 2000);
    } catch { /* no-op */ }
  }

  // ── Data (structured JSON) ──────────────────────────────────────────
  // Node.data is a free-form JSON object/value. The Data tab mirrors the
  // Content / Abstract tabs: a Rendered view (pretty-printed JSON) and a
  // Source view that edits the raw JSON with a live syntax check.
  let showDataSource = $state(false);
  let copiedData = $state(false);
  let editData = $state('');
  let savingData = $state(false);

  // Re-seed the editor from the node whenever node.data changes (initial
  // load, navigation between nodes, and after a save's invalidateAll).
  // Pretty-printed so the Source view is readable and diffable.
  $effect(() => {
    editData = node.data != null ? JSON.stringify(node.data, null, 2) : '';
  });

  // Live JSON syntax check. Returns an error string (shown in red) or null
  // (well-formed). A top-level `null` is rejected because Node.data maps to
  // a Prisma `Json?` column that can't be written a bare null through this
  // surface — see the updateData action. Empty is handled separately.
  const dataError = $derived.by(() => {
    const trimmed = editData.trim();
    if (trimmed === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
    if (parsed === null) return 'Top-level null is not allowed — enter an object, array, or value.';
    return null;
  });
  const dataEmpty = $derived(editData.trim() === '');
  const dataValid = $derived(dataError === null);
  // Pretty-printed saved value — both the Rendered view and the dirty-check
  // baseline (so the initial seeded text doesn't count as a change).
  const dataString = $derived(node.data != null ? JSON.stringify(node.data, null, 2) : '');
  const dataDirty = $derived(editData !== dataString);

  async function saveData() {
    if (!dataValid || dataEmpty || !dataDirty) return;
    savingData = true;
    try {
      const fd = new FormData();
      fd.set('data', editData);
      const res = await fetch('?/updateData', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Save failed');
      await invalidateAll();
      showDataSource = false;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      savingData = false;
    }
  }

  async function copyData() {
    if (node.data == null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(node.data, null, 2));
      copiedData = true;
      setTimeout(() => (copiedData = false), 2000);
    } catch { /* no-op */ }
  }

  // ── JSON syntax highlighting (Rendered view only) ───────────────────
  // No highlighter dependency in the portal, and one isn't warranted for
  // JSON: a small tokenizer + classed <span>s does it. Tokens render via
  // Svelte's {#each} (auto-escaped text), NOT {@html}, so there's no
  // sanitization surface (Invariant P4 doesn't apply). The Source editor
  // stays a plain textarea — coloring an *editable* field needs a real code
  // editor (CodeMirror/Monaco), which this intentionally doesn't pull in.
  type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain';
  const jsonTokenClass: Record<JsonTokenType, string> = {
    key: 'text-indigo-600 dark:text-indigo-400',
    string: 'text-emerald-600 dark:text-emerald-400',
    number: 'text-amber-600 dark:text-amber-400',
    boolean: 'text-purple-600 dark:text-purple-400',
    null: 'text-zinc-400 dark:text-zinc-500',
    punct: 'text-zinc-400 dark:text-zinc-500',
    plain: '',
  };
  // Tokenize pretty-printed JSON. Gaps between matches (the indentation /
  // newlines) are preserved verbatim as 'plain' so the layout round-trips.
  // A string is a key when the next non-space char is ':'.
  function highlightJson(src: string): Array<{ text: string; type: JsonTokenType }> {
    const tokens: Array<{ text: string; type: JsonTokenType }> = [];
    const re = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) tokens.push({ text: src.slice(last, m.index), type: 'plain' });
      const t = m[0];
      let type: JsonTokenType;
      if (t[0] === '"') type = /^\s*:/.test(src.slice(re.lastIndex)) ? 'key' : 'string';
      else if (t === 'true' || t === 'false') type = 'boolean';
      else if (t === 'null') type = 'null';
      else if (t.length === 1 && '{}[],:'.includes(t)) type = 'punct';
      else type = 'number';
      tokens.push({ text: t, type });
      last = re.lastIndex;
    }
    if (src.length > last) tokens.push({ text: src.slice(last), type: 'plain' });
    return tokens;
  }
  const highlightedData = $derived(highlightJson(dataString));

  const hasReferences = $derived(node.outgoingEdges.length > 0 || node.incomingEdges.length > 0);
  const hasContent = $derived(!!node.content);
  const hasAbstract = $derived(!!node.abstract);
  const hasData = $derived(node.data != null);

  // ── Edge editing ────────────────────────────────────────────────────
  // Edge editing replaces the full outgoing set via upsertNode(edges: [...]).
  // We keep a local editable copy and commit via the updateEdges action.

  interface EditableEdge {
    targetId: string;
    targetName: string;
    targetLoc: string;
    label: string;
  }

  let editingEdges = $state(false);
  let editableEdges = $state<EditableEdge[]>([]);
  let newEdgeTargetQuery = $state('');
  let newEdgeLabel = $state('');

  function startEditEdges() {
    editableEdges = node.outgoingEdges.map((e) => ({
      targetId: e.target.id,
      targetName: e.target.name ?? e.target.loc,
      targetLoc: e.target.loc,
      label: e.label ?? '',
    }));
    newEdgeTargetQuery = '';
    newEdgeLabel = '';
    editingEdges = true;
  }

  function cancelEditEdges() {
    editingEdges = false;
    editableEdges = [];
  }

  function removeEditableEdge(idx: number) {
    editableEdges = editableEdges.filter((_, i) => i !== idx);
  }

  function addEditableEdge() {
    // Match the target by loc against graphNodes (loaded on the page already).
    const candidates = data.graphNodes ?? [];
    const q = newEdgeTargetQuery.trim().toLowerCase();
    if (!q) return;
    const target = candidates.find(
      (n) => n.loc.toLowerCase() === q || n.name?.toLowerCase() === q,
    ) ?? candidates.find(
      (n) => n.loc.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q),
    );
    if (!target) {
      addEdgeError = `No node found matching "${newEdgeTargetQuery}"`;
      return;
    }
    if (editableEdges.some((e) => e.targetId === target.id && e.label === newEdgeLabel.trim())) {
      addEdgeError = 'That edge already exists';
      return;
    }
    editableEdges = [
      ...editableEdges,
      {
        targetId: target.id,
        targetName: target.name ?? target.loc,
        targetLoc: target.loc,
        label: newEdgeLabel.trim(),
      },
    ];
    newEdgeTargetQuery = '';
    newEdgeLabel = '';
    addEdgeError = null;
  }

  let addEdgeError = $state<string | null>(null);
  const editableEdgesJson = $derived(JSON.stringify(
    editableEdges.map((e) => ({ targetId: e.targetId, label: e.label || null })),
  ));

  // Children: direct children of this node's loc
  const children = $derived(
    (data.graphNodes ?? [])
      .filter((n) => {
        if (n.loc === node.loc) return false;
        if (!n.loc.startsWith(node.loc + ':')) return false;
        const rest = n.loc.slice(node.loc.length + 1);
        return !rest.includes(':');
      })
      .sort((a, b) => {
        if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
        if (a.seq !== null) return -1;
        if (b.seq !== null) return 1;
        return a.loc.localeCompare(b.loc);
      })
  );
  const hasChildren = $derived(children.length > 0);
  const childrenReorderable = $derived(children.some((c) => c.seq !== null));
  let childDragError = $state<string | null>(null);

  // URN slug for edit form
  const urnSlug = $derived(node.loc);

  type NodeTab = 'content' | 'abstract' | 'data' | 'children' | 'references' | 'settings';

  // Content / Abstract / Data / References / Settings are always present;
  // Children only when the node has children. (#256: Content is no longer
  // gated on hasContent — an empty node still needs an authoring surface;
  // Data follows the same always-on rationale so there's a portal path to
  // add structured data to a node that has none.)
  const availableTabs = $derived<NodeTab[]>(
    hasChildren
      ? ['content', 'abstract', 'data', 'children', 'references', 'settings']
      : ['content', 'abstract', 'data', 'references', 'settings'],
  );

  function defaultTab(): NodeTab {
    // Content when present, else the Children list for a pure container
    // node, else Content (its empty-state authoring surface).
    return hasContent ? 'content' : hasChildren ? 'children' : 'content';
  }

  let activeTab = $state<NodeTab>(defaultTab());

  // SvelteKit reuses this component instance when navigating between nodes
  // (the route param changes but the component doesn't remount), so all the
  // transient `$state` below would otherwise leak across nodes — a stale
  // Source editor, an armed delete confirmation, or an active tab the new
  // node doesn't have (#251). Reset everything when the node id changes, and
  // re-pick the new node's default tab.
  let lastNodeId: string | undefined;
  $effect(() => {
    if (lastNodeId !== node.id) {
      lastNodeId = node.id;
      activeTab = defaultTab();
      showSource = false;
      showAbstractSource = false;
      showDataSource = false;
      confirmDelete = false;
      editingEdges = false;
      isEditing = false;
      return;
    }
    // Same node: keep the active tab valid if its availability changes (e.g.
    // children removed). Reading `availableTabs` tracks hasChildren so the
    // fallback fires reliably. Content is always present (#256).
    if (!availableTabs.includes(activeTab)) activeTab = 'content';
  });

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>{node.name} &middot; Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb -->
  <Breadcrumb items={[
    { label: 'Memories', href: memoriesHref },
    { label: data.graph.name, href: basePath },
    { label: 'Nodes', href: `${basePath}/nodes` },
    ...data.breadcrumb.slice(0, -1).map((seg) =>
      seg.nodeId
        ? { label: seg.label, href: `${basePath}/nodes/${seg.nodeId}` }
        : { label: seg.label }
    ),
    { label: node.name },
  ]} />
  <!-- Create missing parent nodes -->
  {#each data.breadcrumb.slice(0, -1) as seg}
    {#if !seg.nodeId}
      <form method="POST" action="?/createParent" use:enhance class="inline">
        <input type="hidden" name="loc" value={seg.path} />
        <input type="hidden" name="name" value={seg.label} />
        <button type="submit" class="text-xs text-indigo-500 hover:text-indigo-400">
          + Create parent node "{seg.label}"
        </button>
      </form>
    {/if}
  {/each}

  <!-- Header -->
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white"><span class="text-zinc-400 font-normal">Node:</span> {node.name}</h1>
      <Urn value={fullUrn} type="node" />
      {#if node.description}
        <p class="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{node.description}</p>
      {/if}
    </div>
    <a
      href="{basePath}/nodes/new?parent={encodeURIComponent(cleanLocInput(node.loc))}"
      class="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
    >
      {createNodeStrings.addChildButton()}
    </a>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Tabs: Content | Abstract | Children (when present) | References | Settings -->
  <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
    <div class="mb-3 flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
      <!-- Always shown (#256) — an empty node still needs an authoring
           surface, or there's no portal path to add content. Mirrors the
           Abstract tab's always-on treatment below. -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'content' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'content'}
      >Content
        {#if !hasContent}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      <!-- Always shown — an empty abstract still needs an authoring surface
           (the default vector-index source), same rationale as Content (#256). -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'abstract' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'abstract'}
      >Abstract
        {#if !hasAbstract}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      <!-- Always shown — Node.data is free-form JSON; an empty node still
           needs an authoring surface, same rationale as Content/Abstract. -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'data' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'data'}
      >Data
        {#if !hasData}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      {#if hasChildren}
        <button
          class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'children' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
          onclick={() => activeTab = 'children'}
        >Children <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{children.length}</span></button>
      {/if}
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'references' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'references'}
      >References
        {#if hasReferences}
          <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{node.outgoingEdges.length + node.incomingEdges.length}</span>
        {/if}
      </button>
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'settings' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'settings'}
      >Settings</button>
    </div>

    <!-- ═══ CONTENT TAB ═══ -->
    {#if activeTab === 'content'}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showSource = false}
          >Rendered</button>
          <button
            class="px-2 py-1 text-xs {showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showSource = true}
          >Source</button>
        </div>
        {#if hasContent}
          <button onclick={copyContent} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy content">
            {#if copied}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showSource}
        <div class="mt-3">
          <!-- #247: fill the available viewport height rather than a fixed
               300px, so the source editor is comfortable for long content.
               h- is viewport-relative (minus the nav/breadcrumb/header/tabs
               chrome above and the Save row below); min-h-[300px] floors it
               so it stays usable on short/landscape-mobile viewports where
               100vh is small. The textarea scrolls internally. -->
          <textarea
            class="w-full h-[calc(100vh-18rem)] min-h-[300px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
            placeholder={createNodeStrings.contentSourcePlaceholder()}
            bind:value={editContent}
          ></textarea>
          <div class="mt-2 flex justify-end">
            <button
              onclick={saveContent}
              disabled={saving || editContent === (node.content ?? '')}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      {:else if hasContent}
        <div class="prose prose-sm prose-zinc mt-3 max-w-none dark:prose-invert">{@html renderedHtml}</div>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">{createNodeStrings.contentEmptyTitle()}</p>
          <button
            onclick={() => showSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >{createNodeStrings.contentEmptyCta()}</button>
        </div>
      {/if}
    {/if}

    <!-- ═══ ABSTRACT TAB ═══ -->
    {#if activeTab === 'abstract'}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showAbstractSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showAbstractSource = false}
          >Rendered</button>
          <button
            class="px-2 py-1 text-xs {showAbstractSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showAbstractSource = true}
          >Source</button>
        </div>
        {#if hasAbstract}
          <button onclick={copyAbstract} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy abstract">
            {#if copiedAbstract}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showAbstractSource}
        <div class="mt-3">
          <textarea
            class="w-full min-h-[120px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
            maxlength={ABSTRACT_MAX}
            placeholder="A paragraph-length summary of this node. This is the default source for vector search."
            bind:value={editAbstract}
          ></textarea>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs {editAbstract.length > ABSTRACT_MAX ? 'text-red-500' : 'text-zinc-400'}">{editAbstract.length} / {ABSTRACT_MAX}</span>
            <button
              onclick={saveAbstract}
              disabled={savingAbstract || editAbstract === (node.abstract ?? '')}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{savingAbstract ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      {:else if hasAbstract}
        <div class="prose prose-sm prose-zinc mt-3 max-w-none dark:prose-invert">{@html renderedAbstractHtml}</div>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">No abstract yet. The abstract is a paragraph-length summary and the default source for vector search.</p>
          <button
            onclick={() => showAbstractSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >Write an abstract</button>
        </div>
      {/if}
    {/if}

    <!-- ═══ DATA TAB ═══ -->
    {#if activeTab === 'data'}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showDataSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showDataSource = false}
          >Rendered</button>
          <button
            class="px-2 py-1 text-xs {showDataSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showDataSource = true}
          >Source</button>
        </div>
        {#if hasData}
          <button onclick={copyData} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy data">
            {#if copiedData}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showDataSource}
        <div class="mt-3">
          <!-- Source editor: monospace, fills the viewport like the Content
               editor. The border turns red while the JSON is malformed; the
               status row below shows a green check when it parses. -->
          <textarea
            class="w-full h-[calc(100vh-20rem)] min-h-[240px] rounded-lg border bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none {dataValid ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 focus:border-red-500 dark:border-red-700'}"
            placeholder={'{\n  "key": "value"\n}'}
            spellcheck="false"
            bind:value={editData}
          ></textarea>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div class="text-xs">
              {#if dataEmpty}
                <span class="text-zinc-400">Enter a JSON value to save.</span>
              {:else if dataValid}
                <span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Valid JSON
                </span>
              {:else}
                <span class="text-red-500">{dataError}</span>
              {/if}
            </div>
            <button
              onclick={saveData}
              disabled={savingData || !dataValid || dataEmpty || !dataDirty}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{savingData ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      {:else if hasData}
        <pre class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 overflow-x-auto">{#each highlightedData as tok}<span class={jsonTokenClass[tok.type]}>{tok.text}</span>{/each}</pre>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">No structured data. Node.data holds a free-form JSON object.</p>
          <button
            onclick={() => showDataSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >Add data</button>
        </div>
      {/if}
    {/if}

    <!-- ═══ CHILDREN TAB ═══ -->
    {#if activeTab === 'children' && hasChildren}
      {#if childDragError}
        <p class="mb-2 rounded-md border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{childDragError}</p>
      {/if}
      <NodeList
        nodes={children}
        {basePath}
        memoryUrn={data.graph.urn ?? ''}
        orderable={childrenReorderable}
        onreorder={async (orderedLocs) => {
          const updates = orderedLocs.map((loc, i) => ({ loc, seq: i + 1 }));
          try {
            const fd = new FormData();
            fd.set('updates', JSON.stringify(updates));
            const res = await fetch('?/reorder', { method: 'POST', body: fd });
            if (!res.ok) throw new Error('Reorder failed');
            invalidateAll();
          } catch (err) {
            childDragError = err instanceof Error ? err.message : 'Reorder failed';
            setTimeout(() => { childDragError = null; }, 3000);
          }
        }}
      />
    {/if}

    <!-- ═══ REFERENCES TAB ═══ -->
    {#if activeTab === 'references'}
      <!-- Outgoing edges — editable -->
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Outgoing</h3>
        {#if !editingEdges}
          <button type="button" onclick={startEditEdges}
            class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
            Edit edges
          </button>
        {/if}
      </div>

      {#if !editingEdges}
        {#if node.outgoingEdges.length > 0}
          <div class="space-y-1">
            {#each node.outgoingEdges as edge}
              <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <a href="{basePath}/nodes/{edge.target.id}" class="font-mono text-indigo-500 hover:underline dark:text-indigo-400">{edge.target.name || edge.target.loc}</a>
                {#if edge.label}<span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{edge.label}</span>{/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-zinc-400">No outgoing edges.</p>
        {/if}
      {:else}
        <!-- Edit mode: list with remove buttons, add form, save/cancel -->
        <form method="POST" action="?/updateEdges" use:enhance={() => {
          return async ({ update }) => { editingEdges = false; await update(); };
        }}>
          <input type="hidden" name="edges" value={editableEdgesJson} />

          {#if editableEdges.length > 0}
            <div class="space-y-1">
              {#each editableEdges as edge, idx}
                <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <span class="font-mono text-indigo-600 dark:text-indigo-300">{edge.targetName}</span>
                  <span class="text-xs text-zinc-400">{edge.targetLoc}</span>
                  {#if edge.label}<span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{edge.label}</span>{/if}
                  <div class="flex-1"></div>
                  <button type="button" onclick={() => removeEditableEdge(idx)}
                    class="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                    Remove
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-zinc-400">No outgoing edges.</p>
          {/if}

          <!-- Add a new edge -->
          <div class="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
            <p class="mb-2 text-xs font-medium text-zinc-500">Add edge</p>
            <div class="flex flex-wrap items-end gap-2">
              <div class="flex-1 min-w-[200px]">
                <label for="newEdgeTarget" class="mb-1 block text-xs text-zinc-500">Target (loc or name)</label>
                <input id="newEdgeTarget" type="text" bind:value={newEdgeTargetQuery}
                  placeholder="e.g. specs:auth:jwt"
                  class="{inputClass} font-mono text-xs" />
              </div>
              <div class="w-40">
                <label for="newEdgeLabel" class="mb-1 block text-xs text-zinc-500">Label (optional)</label>
                <input id="newEdgeLabel" type="text" bind:value={newEdgeLabel}
                  placeholder="e.g. cites"
                  class="{inputClass} text-xs" />
              </div>
              <button type="button" onclick={addEditableEdge}
                class="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-indigo-950">
                + Add
              </button>
            </div>
            {#if addEdgeError}
              <p class="mt-2 text-xs text-red-500">{addEdgeError}</p>
            {/if}
          </div>

          <div class="mt-4 flex items-center gap-2">
            <button type="submit" class="rounded-lg px-4 py-2 text-xs font-semibold text-white" style="background: #fb8500;">
              Save edges
            </button>
            <button type="button" onclick={cancelEditEdges}
              class="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </form>
      {/if}

      <!-- Incoming edges — read-only (owned by other nodes) -->
      {#if node.incomingEdges.length > 0}
        <h3 class="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-500">Incoming <span class="ml-1 font-normal normal-case text-zinc-400">(edit on the source node)</span></h3>
        <div class="space-y-1">
          {#each node.incomingEdges as edge}
            <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <a href="{basePath}/nodes/{edge.source.id}" class="font-mono text-indigo-500 hover:underline dark:text-indigo-400">{edge.source.name || edge.source.loc}</a>
              {#if edge.label}<span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{edge.label}</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- ═══ SETTINGS TAB ═══ -->
    {#if activeTab === 'settings'}
      <div class="max-w-3xl space-y-8">
        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="font-semibold text-zinc-900 dark:text-white">Node</h2>
            {#if !isEditing}
              <div class="flex items-center gap-2">
                <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
                <a href="{basePath}/graph?focus={node.id}" class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Graph</a>
              </div>
            {/if}
          </div>

          {#if isEditing}
            <form method="POST" action="?/updateMeta" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }}
              class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
              <div>
                <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                <input id="editName" name="name" type="text" required value={node.name} class={inputClass} />
              </div>
              <div>
                <label for="editLoc" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN <span class="text-zinc-500">(changing this moves the node)</span></label>
                <div class="flex items-stretch">
                  <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.graph.urn}:</span>
                  <input id="editLoc" name="loc" type="text" value={urnSlug}
                    class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
                </div>
              </div>
              <div>
                <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
                <input id="editDescription" name="description" type="text" value={node.description ?? ''} placeholder="Short caption" class={inputClass} />
              </div>
              <div>
                <label for="editAlias" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Alias</label>
                <input id="editAlias" name="alias" type="text" value={node.alias ?? ''} placeholder="Optional" class={inputClass} />
              </div>
              <div>
                <label for="editSeq" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Seq <span class="text-zinc-500">(sort order)</span></label>
                <input id="editSeq" name="seq" type="number" value={node.seq ?? ''} placeholder="Optional" class={inputClass} />
              </div>
              <div>
                <label for="editTags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
                <input id="editTags" name="tags" type="text" value={node.tags.join(', ')} class={inputClass} />
              </div>
              <div class="flex gap-3">
                <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Save</button>
                <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
              </div>
            </form>
          {:else}
            <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Name</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{node.name}</span>
              </div>
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Type</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{node.nodeType}</span>
              </div>
              {#if node.description}
                <div class="px-5 py-3">
                  <span class="text-sm text-zinc-500">Description</span>
                  <p class="mt-1 text-sm text-zinc-900 dark:text-white">{node.description}</p>
                </div>
              {/if}
              {#if node.alias}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Alias</span>
                  <span class="text-sm font-mono text-zinc-900 dark:text-white">{node.alias}</span>
                </div>
              {/if}
              {#if node.seq !== null && node.seq !== undefined}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Seq</span>
                  <span class="text-sm tabular-nums text-zinc-900 dark:text-white">{node.seq}</span>
                </div>
              {/if}
              {#if node.tags.length > 0}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Tags</span>
                  <div class="flex flex-wrap gap-1">
                    {#each node.tags as tag}
                      <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if node.isRunnable}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Runnable</span>
                  <span class="text-sm text-green-600 dark:text-green-400">Yes</span>
                </div>
              {/if}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Created</span>
                <span class="text-sm text-zinc-900 dark:text-white">{new Date(node.createdAt).toLocaleDateString()}</span>
              </div>
              {#if node.updatedAt}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Updated</span>
                  <span class="text-sm text-zinc-900 dark:text-white">{new Date(node.updatedAt).toLocaleDateString()}</span>
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <!-- Data now has its own top-level tab (Rendered/Source + editing);
             the former read-only block here would just duplicate it. -->

        <!-- Danger zone -->
        <section class="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
          {#if !confirmDelete}
            <button onclick={() => confirmDelete = true} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
              Delete node
            </button>
          {:else}
            <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
              <span class="text-sm text-red-500">Delete "{node.name}"? This cannot be undone.</span>
              <button type="submit" class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500">Yes, delete</button>
              <button type="button" onclick={() => confirmDelete = false} class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
            </form>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>
