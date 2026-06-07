<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { deleteMemoryStrings } from '$lib/i18n/delete-memory-strings';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  // Agent system memories are owned by their agent and have a stripped-down
  // settings view: no org transfer, no categories, no license, no visibility,
  // no subscriptions. Most fields don't apply (they're the agent's program,
  // not a shared knowledge artifact).
  const isAgentSystem = $derived(g.type === 'AGENT_SYSTEM');

  // Spec 013 + 034: class-aware delete authority. Server-side resolver enforces
  // this; the UI affordance hide is presentation only (per Constitution
  // Principle V). Owner-only classes (personal/private) — owner only, via
  // Memory.userId. All others — any org admin. AGENT_SYSTEM memories are
  // excluded entirely (the resolver refuses; deleting goes through the owning
  // agent).
  // #260: org may be null when viewing a memory owned by an org the user isn't
  // a member of — they then have no membership row, so canDelete is false
  // (server-enforced regardless).
  const myMember = $derived(
    data.org?.members?.find((m) => m.user?.id === data.user?.id),
  );
  const isOwnerOnly = $derived(g.class === 'personal' || g.class === 'private');
  const canDelete = $derived(
    !isAgentSystem &&
      (isOwnerOnly
        ? !!data.user?.id && data.user.id === g.userId
        : myMember?.role === 'ADMIN' || myMember?.role === 'OWNER'),
  );

  let isEditing = $state(false);
  let githubOpen = $state(false);
  let saving = $state(false);
  let syncing = $state(false);
  let pushing = $state(false);
  let confirmDelete = $state(false);

  $effect(() => {
    if (g.source) githubOpen = true;
  });

  const urnSlug = $derived(g.urn ? g.urn.split(':').slice(1).join(':') : '');
  const visibilityLabel: Record<string, string> = { PRIVATE: 'Private', ORGANIZATION: 'Organization', PUBLIC: 'Public' };

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function savingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      saving = true;
      return async ({ update }) => { saving = false; isEditing = false; await update(); };
    });
  }
  function syncingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      syncing = true;
      return async ({ update }) => { syncing = false; await update(); };
    });
  }
  function pushingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      pushing = true;
      return async ({ update }) => { pushing = false; await update(); };
    });
  }

  // ── Vector index (spec 033 §2/§3) ───────────────────────────────────
  // The FR-026 disclosure text MUST match the server's FR_026_DISCLOSURE
  // constant verbatim (src/lib/entityRef/errors.ts in hadron-server).
  const FR_026_DISCLOSURE = [
    '(a) Stored vectors are plaintext — they are NOT encrypted at rest the way the content column is.',
    '(b) Embedding inversion can partially reconstruct source text from a vector (partial, not full reconstruction).',
    '(c) Anyone with database access is therefore a potential viewer of that partial content, even though the content column itself is encrypted.',
    "(d) The opt-in is revocable; revoking stops further indexing AND removes the memory's already-stored vectors.",
  ];

  let viEnabled = $state(g.vectorIndexEnabled ?? false);
  let viSource = $state<'abstract' | 'contentChunks' | 'both'>(g.embeddingSource ?? 'abstract');
  let viChunkTokens = $state(g.chunkTokens != null ? String(g.chunkTokens) : '');
  let viChunkOverlap = $state(g.chunkOverlap != null ? String(g.chunkOverlap) : '');
  let viForceFixedSize = $state(g.forceFixedSize ?? false);
  let viSaving = $state(false);
  let showDisclosure = $state(false);
  let disclosureAccepted = $state(false);
  let confirmRevoke = $state(false);
  let viFormEl: HTMLFormElement;

  // Resync local state when the page data changes (after a successful save,
  // invalidateAll reloads `g`). Mirrors the node-detail editContent pattern —
  // `g.*` only changes on navigation/invalidate, never mid-edit. The enable
  // toggle is left alone while the disclosure panel is open so a server
  // backstop (needsEncryptedAck) can keep the user's enable intent and let
  // them acknowledge + enable in one flow instead of resyncing back to false.
  $effect(() => {
    if (!showDisclosure) viEnabled = g.vectorIndexEnabled ?? false;
    viSource = g.embeddingSource ?? 'abstract';
    viChunkTokens = g.chunkTokens != null ? String(g.chunkTokens) : '';
    viChunkOverlap = g.chunkOverlap != null ? String(g.chunkOverlap) : '';
    viForceFixedSize = g.forceFixedSize ?? false;
  });

  const viSourceIncludesChunks = $derived(viSource === 'contentChunks' || viSource === 'both');
  const viDirty = $derived(
    viEnabled !== (g.vectorIndexEnabled ?? false) ||
    viSource !== (g.embeddingSource ?? 'abstract') ||
    viChunkTokens.trim() !== (g.chunkTokens != null ? String(g.chunkTokens) : '') ||
    viChunkOverlap.trim() !== (g.chunkOverlap != null ? String(g.chunkOverlap) : '') ||
    viForceFixedSize !== (g.forceFixedSize ?? false),
  );
  // First-time enable on an encrypted memory that hasn't accepted FR-026 yet.
  const viNeedsAck = $derived(!!g.isEncrypted && viEnabled && !g.vectorIndexEncryptedAckAt);
  // Turning the index OFF on an encrypted memory that currently has it on —
  // the server drops stored vectors, so confirm first.
  const viIsRevoking = $derived(!!g.isEncrypted && !viEnabled && (g.vectorIndexEnabled ?? false));

  function attemptVectorSave() {
    if (viNeedsAck && !disclosureAccepted) { showDisclosure = true; return; }
    if (viIsRevoking && !confirmRevoke) { confirmRevoke = true; return; }
    viFormEl.requestSubmit();
  }

  function vectorEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      viSaving = true;
      return async ({ result, update }) => {
        viSaving = false;
        const needsAck =
          result.type === 'failure' &&
          (result.data as { needsEncryptedAck?: boolean } | undefined)?.needsEncryptedAck === true;
        if (result.type === 'success') {
          showDisclosure = false;
          confirmRevoke = false;
          disclosureAccepted = false;
        }
        await update();
        // Server backstop: the encrypted memory needs acknowledgement. Re-open
        // the disclosure AFTER the data resync (the resync effect leaves
        // viEnabled alone while showDisclosure is true) so the user can accept
        // and enable in a single follow-up submit.
        if (needsAck) {
          viEnabled = true;
          showDisclosure = true;
        }
      };
    });
  }
</script>

<svelte:head><title>{g.name} &middot; Settings &middot; Hadron</title></svelte:head>

<div class="space-y-8">
  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.success || form?.synced || (form as any)?.pushed}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {form?.synced ? 'Memory synced.' : (form as any)?.pushed ? 'Pushed to Git.' : 'Changes saved.'}
    </div>
  {/if}

  <!-- Memory settings -->
  <section class="max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Memory</h2>
      {#if !isEditing}
        <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
    </div>

    {#if isEditing}
      <form id="graph-settings" method="POST" action="?/update" use:savingEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
        {#if isAgentSystem}
          <p class="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            This is an agent system memory. Its name, URN, and visibility are
            managed by the owning agent. Most other metadata fields don't apply.
          </p>
        {:else}
          <div>
            <label for="displayName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
            <input id="displayName" name="displayName" type="text" value={g.name} class={inputClass} />
          </div>

          <!-- #260: org is no longer in the URL; submit the current org id so
               the server can skip a no-op transfer when the select is absent. -->
          <input type="hidden" name="currentOrganizationId" value={g.organizationId} />

          {#if (data as any).allOrgs && (data as any).allOrgs.length > 1}
            <div>
              <label for="organizationId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Organization</label>
              <select id="organizationId" name="organizationId" class={inputClass}>
                {#each (data as any).allOrgs as org (org.id)}
                  <option value={org.id} selected={org.id === g.organizationId}>{org.name} ({org.urn})</option>
                {/each}
              </select>
            </div>
          {/if}

          <div>
            <label for="urnSlugInput" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
            <div class="flex items-stretch">
              <!-- #260: org may be null (non-member viewing an org-owned
                   memory). Only render the `<org-urn>:` prefix when we have it,
                   so it never shows a bare ":". -->
              {#if data.org?.urn}
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.org.urn}:</span>
              {/if}
              <input id="urnSlugInput" name="urnSlug" type="text" value={urnSlug}
                class="w-full border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {data.org?.urn ? 'rounded-r-lg' : 'rounded-lg'}" />
            </div>
          </div>
        {/if}

        <div>
          <label for="shortDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Short description</label>
          <input id="shortDescription" name="shortDescription" type="text" value={g.shortDescription ?? ''} class={inputClass} />
        </div>
        <div>
          <label for="description" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
          <textarea id="description" name="description" rows="3" class={inputClass}>{g.description ?? ''}</textarea>
        </div>
        <div>
          <label for="tags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
          <input id="tags" name="tags" type="text" value={(g.tags ?? []).join(', ')} class={inputClass} />
        </div>

        {#if !isAgentSystem}
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label for="category0" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
              <input id="category0" name="category0" type="text" value={g.category0 ?? ''} class={inputClass} />
            </div>
            <div>
              <label for="category1" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Subcategory</label>
              <input id="category1" name="category1" type="text" value={g.category1 ?? ''} class={inputClass} />
            </div>
            <div>
              <label for="category2" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-subcategory</label>
              <input id="category2" name="category2" type="text" value={g.category2 ?? ''} class={inputClass} />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="license" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">License</label>
              <input id="license" name="license" type="text" value={g.license ?? ''} class={inputClass} />
            </div>
            <div>
              <label for="homeUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Home URL</label>
              <input id="homeUrl" name="homeUrl" type="url" value={g.homeUrl ?? ''} class={inputClass} />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="iconUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Icon URL</label>
              <input id="iconUrl" name="iconUrl" type="url" value={g.iconUrl ?? ''} class={inputClass} />
            </div>
            <div>
              <label for="heroUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Hero image URL</label>
              <input id="heroUrl" name="heroUrl" type="url" value={g.heroUrl ?? ''} class={inputClass} />
            </div>
          </div>
          <div>
            <label for="visibility" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
            <select id="visibility" name="visibility" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="PRIVATE" selected={g.visibility === 'PRIVATE'}>Private</option>
              <option value="ORGANIZATION" selected={g.visibility === 'ORGANIZATION'}>Organization</option>
              <option value="PUBLIC" selected={g.visibility === 'PUBLIC'}>Public</option>
            </select>
          </div>
        {/if}

        <!-- GitHub integration -->
        <div class="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <button type="button" onclick={() => githubOpen = !githubOpen}
            class="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50 rounded-lg">
            <span>GitHub integration {#if !g.source}<span class="font-normal text-zinc-500">(optional)</span>{/if}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {githubOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
            </svg>
          </button>
          {#if githubOpen}
            <div class="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
              <div>
                <label for="source" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Git source URL</label>
                <input id="source" name="source" type="text" value={g.source ?? ''} placeholder="https://github.com/owner/repo.git" class={inputClass} />
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="readBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Read branch</label>
                  <input id="readBranch" name="readBranch" type="text" value={g.readBranch ?? ''} placeholder="main" class={inputClass} />
                </div>
                <div>
                  <label for="writeBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">Write branch</label>
                  <input id="writeBranch" name="writeBranch" type="text" value={g.writeBranch ?? ''} placeholder="hadron-updates" class={inputClass} />
                </div>
              </div>
            </div>
          {/if}
        </div>

        <div class="flex gap-3">
          <button type="submit" disabled={saving} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
        </div>
      </form>
    {:else}
      <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
        {#if isAgentSystem && g.agent}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Owned by agent</span>
            <a href={`/app/agents/${g.agent.id}`} class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">{g.agent.name}</a>
          </div>
        {/if}
        {#if !isAgentSystem}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Visibility</span>
            <span class="text-sm font-medium text-zinc-900 dark:text-white">{visibilityLabel[g.visibility] ?? g.visibility}</span>
          </div>
        {/if}
        {#if g.shortDescription}
          <div class="px-5 py-3">
            <span class="text-sm text-zinc-500">Short description</span>
            <p class="mt-1 text-sm text-zinc-900 dark:text-white">{g.shortDescription}</p>
          </div>
        {/if}
        {#if g.description}
          <div class="px-5 py-3">
            <span class="text-sm text-zinc-500">Description</span>
            <p class="mt-1 text-sm text-zinc-900 dark:text-white whitespace-pre-wrap">{g.description}</p>
          </div>
        {/if}
        {#if g.tags?.length}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Tags</span>
            <span class="text-sm text-zinc-900 dark:text-white">{g.tags.join(', ')}</span>
          </div>
        {/if}
        {#if g.source}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Git source</span>
            <span class="text-sm font-mono text-zinc-900 dark:text-white">{g.source}</span>
          </div>
        {/if}
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Sync status</span>
          <span class="text-sm text-zinc-900 dark:text-white">{g.syncStatus ?? '—'}{#if g.lastSyncedAt} · {new Date(g.lastSyncedAt).toLocaleDateString()}{/if}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Created</span>
          <span class="text-sm text-zinc-900 dark:text-white">{new Date(g.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      <!-- Sync/push actions (outside edit mode) -->
      <div class="mt-4 flex gap-3">
        <form method="POST" action="?/sync" use:syncingEnhance>
          <button type="submit" disabled={syncing} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white disabled:opacity-50">
            {syncing ? 'Syncing...' : 'Sync from Git'}
          </button>
        </form>
        <form method="POST" action="?/pushToGit" use:pushingEnhance>
          <button type="submit" disabled={pushing} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white disabled:opacity-50">
            {pushing ? 'Pushing...' : 'Push to Git'}
          </button>
        </form>
      </div>
    {/if}
  </section>

  <!-- Spec 033 §2/§3: Vector index settings -->
  <section class="max-w-lg">
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Vector index</h2>
    <form bind:this={viFormEl} method="POST" action="?/updateVectorIndex" use:vectorEnhance
      class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
      <!-- Booleans submitted as explicit hidden values (unchecked checkboxes
           don't post; the server needs true/false, not present/absent). -->
      <input type="hidden" name="vectorIndexEnabled" value={String(viEnabled)} />
      <input type="hidden" name="forceFixedSize" value={String(viForceFixedSize)} />
      <input type="hidden" name="acknowledgeVectorInversionRisk" value={String(disclosureAccepted)} />

      <label class="flex items-start gap-3">
        <input type="checkbox" bind:checked={viEnabled} class="mt-0.5 h-4 w-4" />
        <span>
          <span class="block text-sm font-medium text-zinc-900 dark:text-white">Enable vector index</span>
          <span class="block text-xs text-zinc-500 dark:text-zinc-400">Allows semantic (meaning-based) search over this memory's nodes.</span>
        </span>
      </label>

      {#if g.isEncrypted}
        <p class="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          This memory is <span class="font-medium">encrypted</span>. Enabling the
          vector index requires acknowledging that stored vectors are plaintext
          (see disclosure on save).
        </p>
      {/if}

      {#if viEnabled}
        <div>
          <label for="embeddingSource" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Embedding source</label>
          <select id="embeddingSource" name="embeddingSource" bind:value={viSource} class={inputClass}>
            <option value="abstract">Abstract (default)</option>
            <option value="contentChunks">Content chunks</option>
            <option value="both">Both</option>
          </select>
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">The abstract is the default source. Content chunks index the full body in token windows.</p>
        </div>

        {#if viSourceIncludesChunks}
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="chunkTokens" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Chunk size <span class="text-zinc-500">(tokens, 64–4096)</span></label>
              <input id="chunkTokens" name="chunkTokens" type="text" inputmode="numeric" bind:value={viChunkTokens} placeholder="512" class={inputClass} />
            </div>
            <div>
              <label for="chunkOverlap" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Chunk overlap <span class="text-zinc-500">(tokens, &lt; size)</span></label>
              <input id="chunkOverlap" name="chunkOverlap" type="text" inputmode="numeric" bind:value={viChunkOverlap} placeholder="64" class={inputClass} />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" bind:checked={viForceFixedSize} class="h-4 w-4" />
            Force fixed-size chunking <span class="text-xs text-zinc-500">(bypass structure-aware splitting)</span>
          </label>
        {/if}
      {/if}

      {#if g.vectorIndexEncryptedAckAt}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">Encrypted-index disclosure accepted on {new Date(g.vectorIndexEncryptedAckAt).toLocaleString()}.</p>
      {/if}

      {#if viDirty && !showDisclosure && !confirmRevoke}
        <p class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Saving will drop existing vectors and re-embed all nodes — this can take a while on large memories.
        </p>
      {/if}

      <!-- FR-026 disclosure — text matches the server's FR_026_DISCLOSURE verbatim. -->
      {#if showDisclosure}
        <div class="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
          <p class="text-sm font-semibold text-amber-900 dark:text-amber-200">Enabling vector search on an encrypted memory</p>
          <ul class="space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
            {#each FR_026_DISCLOSURE as line}<li>{line}</li>{/each}
          </ul>
          <label class="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <input type="checkbox" bind:checked={disclosureAccepted} class="h-4 w-4" />
            I understand and accept the tradeoff
          </label>
          <div class="flex gap-2">
            <button type="button" disabled={!disclosureAccepted || viSaving} onclick={() => viFormEl.requestSubmit()}
              class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {viSaving ? 'Saving...' : 'Enable with acknowledgement'}
            </button>
            <button type="button" onclick={() => { showDisclosure = false; disclosureAccepted = false; viEnabled = false; }}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      {/if}

      <!-- Revoke confirmation — disabling drops stored vectors server-side. -->
      {#if confirmRevoke}
        <div class="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/40">
          <p class="text-sm text-red-700 dark:text-red-300">Disabling the index removes this memory's already-stored vectors. Re-enabling later re-embeds every node from scratch.</p>
          <div class="flex gap-2">
            <button type="button" disabled={viSaving} onclick={() => viFormEl.requestSubmit()}
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
              {viSaving ? 'Saving...' : 'Disable and remove vectors'}
            </button>
            <button type="button" onclick={() => { confirmRevoke = false; viEnabled = true; }}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      {/if}

      {#if !showDisclosure && !confirmRevoke}
        <div>
          <button type="button" onclick={attemptVectorSave} disabled={viSaving || !viDirty}
            class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {viSaving ? 'Saving...' : 'Save vector index settings'}
          </button>
        </div>
      {/if}
    </form>
  </section>

  <!-- Subscriptions (not applicable to AGENT_SYSTEM memories) -->
  {#if !isAgentSystem}
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Org subscriptions
      <span class="ml-1 text-sm font-normal text-zinc-500">({g.subscriptions?.length ?? 0})</span>
    </h2>

    {#if g.subscriptions?.length}
      <div class="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each g.subscriptions as s (s.id)}
          <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
            <div class="flex-1">
              <p class="text-sm text-zinc-900 dark:text-white">{s.organization.name}</p>
              <p class="font-mono text-xs text-zinc-500">{s.organization.urn}</p>
            </div>
            <span class="text-xs text-zinc-500">{s.role}</span>
            <form method="POST" action="?/unsubscribe" use:enhance>
              <input type="hidden" name="orgId" value={s.organization.id} />
              <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
            </form>
          </div>
        {/each}
      </div>
    {/if}

    <form method="POST" action="?/subscribe" use:enhance class="flex items-end gap-3 max-w-md">
      <div class="flex-1">
        <label for="subOrgId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Organization ID</label>
        <input id="subOrgId" name="orgId" type="text" required placeholder="org-cuid"
          class="{inputClass} font-mono" />
      </div>
      <div>
        <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
        <select id="subRole" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="READER">Reader</option>
          <option value="CONTRIBUTOR">Contributor</option>
        </select>
      </div>
      <button type="submit" class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">Add</button>
    </form>
  </section>
  {/if}

  <!-- Spec 013: Danger zone — soft-delete affordance for authorized users.
       Server-side authz is the trust boundary; the {#if canDelete} hide is
       presentation only. Pattern verbatim from the agent-detail Danger zone
       (convention node `conventions:portal-soft-delete-flow`). -->
  {#if canDelete}
    <section class="max-w-lg border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h3 class="mb-2 text-sm font-semibold text-red-500">{deleteMemoryStrings.heading()}</h3>
      {#if !confirmDelete}
        <button
          onclick={() => (confirmDelete = true)}
          class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          {deleteMemoryStrings.deleteButton()}
        </button>
      {:else}
        <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
          <!-- #260: owning org id so the post-delete redirect can return to it. -->
          <input type="hidden" name="organizationId" value={g.organizationId} />
          <span class="text-sm text-red-500">{deleteMemoryStrings.confirmPrompt(g.name)}</span>
          <button
            type="submit"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
          >
            {deleteMemoryStrings.confirmYes()}
          </button>
          <button
            type="button"
            onclick={() => (confirmDelete = false)}
            class="text-sm text-zinc-500 hover:text-zinc-300"
          >
            {deleteMemoryStrings.confirmCancel()}
          </button>
        </form>
      {/if}
    </section>
  {/if}
</div>
