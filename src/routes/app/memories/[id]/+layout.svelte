<script lang="ts">
  // #266: memory-detail is a tab layout. The layout renders the breadcrumb +
  // header + tab bar; each tab is a sub-route rendered via {@render children()}.
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import SelectOrg from '$lib/components/SelectOrg.svelte';
  import { t } from '$lib/i18n/t';
  import type { OrgSummary } from '$lib/types';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/memories/${data.graph.id}`);

  // ── #520: memory actions menu (⋯), mirroring the node-detail page ─────────
  const g = $derived(data.graph);
  // canDelete mirrors the Settings danger-zone gate (spec 013/034): owner-only
  // classes → the owner; other classes → an org ADMIN/OWNER; agent-system
  // memories are excluded (delete goes through the owning agent). The server
  // resolver is the trust boundary; this only hides the affordance.
  const myMember = $derived(data.org?.members?.find((m) => m.user?.id === data.user?.id));
  const canDelete = $derived(
    g.class !== 'system' &&
      (g.class === 'personal' || g.class === 'private'
        ? !!data.user?.id && data.user.id === g.userId
        : myMember?.role === 'ADMIN' || myMember?.role === 'OWNER'),
  );
  // cloneMemory rejects system + encrypted sources — hide Clone there.
  const cloneable = $derived(g.class !== 'system' && !g.isEncrypted);

  const memoryActions = $derived<NodeMenuAction[]>([
    { id: 'add-node', label: t('memory-actions.add-node', 'Add node') },
    { id: 'edit', label: t('memory-actions.edit', 'Edit memory') },
    ...(cloneable ? [{ id: 'clone', label: t('memory-actions.clone', 'Clone memory') }] : []),
    ...(canDelete ? [{ id: 'delete', label: t('memory-actions.delete', 'Delete memory'), danger: true }] : []),
  ]);

  // Clone dialog — mirrors the node Move dialog: a full target memory URN the
  // user can edit, with a "Select org" button that rewrites the org segment.
  let cloneOpen = $state(false);
  let cloneTarget = $state('');
  let orgPickerOpen = $state(false);
  let cloning = $state(false);
  let cloneError = $state<string | null>(null);

  const bareOrg = (urn: string) => urn.replace(/^hrn:[a-z]+:/, '');
  function memParts(urn: string): { org: string; slug: string } {
    const bare = urn.replace(/^hrn:memory:/, '');
    const i = bare.indexOf('::');
    if (i >= 0) return { org: bare.slice(0, i), slug: bare.slice(i + 2) };
    // Legacy single-`:` URN (hrn:memory:org:slug) — org is the second-to-last
    // segment (mirrors the settings page's legacy parsing). Avoids composing a
    // malformed `::slug-copy` target the server would reject (PR #528 review).
    const parts = bare.split(':');
    return parts.length >= 2
      ? { org: parts[parts.length - 2] ?? '', slug: parts[parts.length - 1] ?? '' }
      : { org: '', slug: bare };
  }

  function onMenuSelect(id: string) {
    cloneOpen = false;
    cloneError = null;
    switch (id) {
      case 'add-node': goto(`${basePath}/nodes/new`); break;
      // Edit + Delete live on the Settings tab; deep-link so the relevant form
      // opens on arrival (?edit=1 / ?delete=1).
      case 'edit': goto(`${basePath}/settings?edit=1`); break;
      case 'delete': goto(`${basePath}/settings?delete=1`); break;
      case 'clone': {
        const { org, slug } = memParts(g.urn);
        cloneTarget = `${org}::${slug}-copy`;
        cloneOpen = true;
        break;
      }
    }
  }

  function onPickOrg(org: OrgSummary) {
    const { slug } = memParts(cloneTarget.includes('::') ? cloneTarget : g.urn);
    cloneTarget = `${bareOrg(org.urn)}::${slug}`;
  }

  async function submitClone() {
    const target = cloneTarget.trim();
    if (!target || cloning) return;
    cloning = true;
    cloneError = null;
    try {
      const res = await fetch(`${basePath}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrn: target }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.memory?.id) {
        cloneError = d.error ?? 'Failed to clone memory';
        return;
      }
      cloneOpen = false;
      goto(`/app/memories/${d.memory.id}`);
    } catch (e) {
      cloneError = e instanceof Error ? e.message : 'Failed to clone memory';
    } finally {
      cloning = false;
    }
  }

  // #260: org context comes from the memory's owning org, which may be one the
  // user isn't a member of (org is then null). Only link the section crumb back
  // to that org's list when the user is a member; otherwise render it as text.
  const orgListHref = $derived(
    data.org ? `/app/orgs/${data.org.id}/${data.graph.class === 'system' ? 'agents' : 'memories'}` : undefined,
  );

  const path = $derived($page.url.pathname);
  // Node detail / create pages bring their own chrome — hide the tab layout there
  // (the regex matches /nodes/<id> and /nodes/new).
  const isNodeDetail = $derived(/\/nodes\/[^/]+/.test(path));
  const tabs = $derived([
    { id: 'info', label: t('memory-detail.tab.info', 'Info'), href: `${basePath}/info` },
    { id: 'nodes', label: t('memory-detail.tab.nodes', 'Nodes'), href: `${basePath}/nodes` },
    { id: 'graph', label: t('memory-detail.tab.graph', 'Graph'), href: `${basePath}/graph` },
    { id: 'settings', label: t('memory-detail.tab.settings', 'Settings'), href: `${basePath}/settings` },
    { id: 'integrations', label: t('memory-detail.tab.integrations', 'Integrations'), href: `${basePath}/integrations` },
    { id: 'subscriptions', label: t('memory-detail.tab.subscriptions', 'Subscriptions'), href: `${basePath}/subscriptions` },
    { id: 'usage', label: t('memory-detail.tab.usage', 'Usage'), href: `${basePath}/usage` },
  ]);

  // The active tab is the sub-route's last segment (falls back to nodes).
  const activeTab = $derived(tabs.find((tb) => path === tb.href)?.id ?? 'nodes');
</script>

<div class="space-y-4">
  {#if !isNodeDetail}
    {@const isAgentSystem = data.graph.class === 'system'}
    <div class="mb-4">
      <Breadcrumb items={[
        { label: isAgentSystem ? 'Agents' : 'Memories', href: orgListHref },
        { label: data.graph.name },
      ]} />
      <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        <span class="text-zinc-400 font-normal">{isAgentSystem ? 'Agent system:' : 'Memory:'}</span> {data.graph.name}
      </h1>
      <Urn value={data.graph.urn} type="memory" />
      {#if isAgentSystem && data.graph.agent}
        <p class="mt-1 text-xs text-zinc-500">
          Owned by agent
          <a href={`/app/agents/${data.graph.agent.id}`} class="text-indigo-500 hover:underline">{data.graph.agent.name}</a>
        </p>
      {/if}
    </div>

    <div class="mb-4 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
      <div class="flex gap-0">
        {#each tabs as tab (tab.id)}
          <a
            href={tab.href}
            class="border-b-2 px-4 py-2 text-sm font-medium transition
              {activeTab === tab.id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
          >{tab.label}</a>
        {/each}
      </div>
      <!-- #520: ⋯ actions menu (Add node / Edit / Clone / Delete), replacing the
           lone "New node" button — mirrors the node-detail page. -->
      <div class="mb-1">
        <NodeActionsMenu
          actions={memoryActions}
          onselect={onMenuSelect}
          label={t('memory-actions.label', 'Memory actions')}
        />
      </div>
    </div>
  {/if}

  <!-- #520: Clone dialog — a full target memory URN with a "Select org" button
       (mirrors the node Move dialog). Submits to the memory clone endpoint. -->
  {#if cloneOpen}
    <div class="fixed inset-0 z-40">
      <button type="button" class="absolute inset-0 cursor-default bg-black/20" aria-label={t('memory-actions.clone.close', 'Close clone dialog')} onclick={() => (cloneOpen = false)}></button>
      <div class="absolute right-4 top-24 w-96 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h3 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('memory-actions.clone.heading', 'Clone memory')}</h3>
        <label for="cloneTarget" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('memory-actions.clone.target-label', 'New memory URN')}</label>
        <input id="cloneTarget" type="text" bind:value={cloneTarget} spellcheck="false"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
        <p class="mt-1 text-xs text-zinc-400">
          <span class="font-mono">org::slug</span> — {t('memory-actions.clone.hint', 'copies every node into a new memory. Fails if one already lives there.')}
        </p>
        <button type="button" onclick={() => (orgPickerOpen = true)}
          class="mt-2 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >{t('memory-actions.clone.select-org', 'Select org…')}</button>
        {#if cloneError}
          <p class="mt-2 text-xs text-red-500">{cloneError}</p>
        {/if}
        <div class="mt-3 flex items-center gap-2">
          <button type="button" onclick={submitClone}
            disabled={cloning || !cloneTarget.trim() || cloneTarget.trim() === memParts(g.urn).org + '::' + memParts(g.urn).slug}
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >{cloning ? t('memory-actions.clone.cloning', 'Cloning…') : t('memory-actions.clone.submit', 'Clone')}</button>
          <button type="button" onclick={() => (cloneOpen = false)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('memory-actions.clone.cancel', 'Cancel')}</button>
        </div>
      </div>
    </div>
    <SelectOrg orgs={data.navOrgs ?? []} bind:open={orgPickerOpen} onselect={onPickOrg} />
  {/if}

  <!-- Nodes/Graph share one MemoryBrowser rendered HERE (in the persistent
       layout) so its tree width, open/closed, search, and filters survive
       switching between the two tabs (the page components would remount). The
       page components only set the <title>. -->
  {#if !isNodeDetail && (activeTab === 'nodes' || activeTab === 'graph')}
    {#if data.nodesFailed}
      <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {t('memory-detail.nodes-load-error', "Couldn't load this memory's nodes — the node service returned an error. This is not the same as an empty memory; try refreshing, and if it persists check the hadron-server logs.")}
      </div>
    {/if}
    <MemoryBrowser nodes={data.graphNodes ?? []} nodesTotal={data.nodesTotal} {basePath} forcedView={activeTab} />
  {/if}
  {@render children()}
</div>
