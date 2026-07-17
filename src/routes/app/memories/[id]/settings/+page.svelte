<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance as kitEnhance } from '$app/forms';
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { deleteMemoryStrings } from '$lib/i18n/delete-memory-strings';
  import type { PageData, ActionData } from './$types';
  import { memorySettingsSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  // Agent system memories are owned by their agent and have a stripped-down
  // settings view: no org transfer, no categories, no license, no visibility,
  // no subscriptions. Most fields don't apply (they're the agent's program,
  // not a shared knowledge artifact).
  const isAgentSystem = $derived(g.class === 'system');

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

  const initialSettingsForm = untrack(() => form?.form ?? data.form);
  const {
    form: settingsForm,
    errors: settingsErrors,
    constraints: settingsConstraints,
    message: settingsMessage,
    allErrors: settingsAllErrors,
    submitting: settingsSubmitting,
    enhance: settingsEnhance,
  } = superForm(initialSettingsForm, {
    validators: zod4Client(memorySettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  let isEditing = $state(untrack(() => !!form?.form && form.form.message !== 'Changes saved.'));
  let confirmDelete = $state(false);

  // #520: the memory-detail ⋯ menu deep-links here (?edit=1 / ?delete=1) to open
  // the relevant form on arrival — Edit → the edit form, Delete → the danger-zone
  // confirm (still gated by canDelete below). Reactive (not a one-time $state
  // init) because SvelteKit REUSES this component when only the query changes,
  // so navigating from the menu while already on Settings must still open the
  // form. Then CONSUME the params (strip via replaceState) so a later
  // load/enhance $page update can't re-open a form the user has since closed
  // (PR #528 review — gemini + codex).
  $effect(() => {
    const sp = $page.url.searchParams;
    const wantEdit = sp.get('edit') === '1';
    const wantDelete = sp.get('delete') === '1';
    if (!wantEdit && !wantDelete) return;
    if (wantEdit) openEdit();
    if (wantDelete) confirmDelete = true;
    const u = new URL($page.url);
    u.searchParams.delete('edit');
    u.searchParams.delete('delete');
    replaceState(u, {});
  });

  // The URN field edits only the bare memory slug (e.g. "mm-holger-personal"),
  // matching the create form (which posts a bare `slug` under the `<org-urn>:`
  // prefix). A memory URN is `hrn:memory:<org>::<slug>[::<role-marker>]`, so the
  // slug is the segment after the first `::` — the org lives in the
  // `hrn:memory:<org>` head and any role marker trails it. The old
  // `split(':').slice(1).join(':')` leaked the full `memory:<org>::<slug>` into
  // the field; editing + saving that then failed the server's bare-slug guard
  // in updateMemory (and once corrupted prod URNs — see that guard's comment).
  // A legacy URN without `::` (e.g. `hrn:memory:org:slug`) has no org/slug
  // separator, so fall back to the last `:`-segment rather than rendering an
  // empty field.
  const urnSlug = $derived(
    g.urn ? (g.urn.includes('::') ? (g.urn.split('::')[1] ?? '') : (g.urn.split(':').pop() ?? '')) : '',
  );
  const urnSlugError = $derived(isAgentSystem ? null : ($settingsErrors.urnSlug?.[0] ?? null));
  const homeUrlError = $derived($settingsErrors.homeUrl?.[0] ?? null);
  const iconUrlError = $derived($settingsErrors.iconUrl?.[0] ?? null);
  const heroUrlError = $derived($settingsErrors.heroUrl?.[0] ?? null);

  // The read-only head rendered before the slug input. Reconstruct it from the
  // memory's OWN canonical URN so it matches exactly — including the `::`
  // org/slug separator and the `memory` type. The old prefix used the org's
  // `urn` (an `hrn:org:<org>` value), which rendered the wrong type and a single
  // trailing colon instead of `hrn:memory:<org>::`.
  const urnPrefix = $derived(g.urn && g.urn.includes('::') ? `${g.urn.split('::')[0]}::` : '');
  const visibilityLabel: Record<string, string> = { ORGANIZATION: 'Organization', PUBLIC: 'Public', GROUP: 'Group' };

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function openEdit() {
    settingsForm.update((current) => ({
      ...current,
      displayName: g.name ?? '',
      urnSlug,
      urnSlugPresent: isAgentSystem ? '' : 'true',
      originalUrnSlug: urnSlug,
      currentUrn: g.urn ?? '',
      organizationId: g.organizationId ?? '',
      currentOrganizationId: g.organizationId ?? '',
      shortDescription: g.shortDescription ?? '',
      description: g.description ?? '',
      tags: (g.tags ?? []).join(', '),
      category0: g.category0 ?? '',
      category1: g.category1 ?? '',
      category2: g.category2 ?? '',
      license: g.license ?? '',
      homeUrl: g.homeUrl ?? '',
      iconUrl: g.iconUrl ?? '',
      heroUrl: g.heroUrl ?? '',
      visibility: g.visibility === 'PUBLIC' ? 'PUBLIC' : 'ORGANIZATION',
    }), { taint: false });
    isEditing = true;
  }

  const settingsActionError = $derived(
    typeof $settingsMessage === 'string' && $settingsMessage !== 'Changes saved.'
      ? $settingsMessage
      : ($settingsAllErrors[0]?.messages[0] ?? null),
  );

  $effect(() => {
    if ($settingsMessage === 'Changes saved.') isEditing = false;
  });

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
    return kitEnhance(formEl, () => {
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
  {#if form?.success}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Changes saved.</div>
  {/if}

  <!-- Memory settings -->
  <section class="max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Memory</h2>
      {#if !isEditing}
        <button onclick={openEdit} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
    </div>

    {#if isEditing}
      <form id="graph-settings" method="POST" action="?/update" use:settingsEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
        {#if settingsActionError}
          <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{settingsActionError}</div>
        {/if}
        {#if isAgentSystem}
          <p class="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            This is an agent system memory. Its name, URN, and visibility are
            managed by the owning agent. Most other metadata fields don't apply.
          </p>
        {:else}
          <div>
            <label for="displayName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
            <input id="displayName" name="displayName" type="text" bind:value={$settingsForm.displayName} {...$settingsConstraints.displayName} class={inputClass} />
          </div>

          <!-- #260: org is no longer in the URL; submit the current org id so
               the server can skip a no-op transfer when the select is absent. -->
          <input type="hidden" name="currentOrganizationId" value={$settingsForm.currentOrganizationId} />

          {#if (data as any).allOrgs && (data as any).allOrgs.length > 1}
            <div>
              <label for="organizationId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Organization</label>
              <select id="organizationId" name="organizationId" bind:value={$settingsForm.organizationId} class={inputClass}>
                {#each (data as any).allOrgs as org (org.id)}
                  <option value={org.id}>{org.name} ({org.urn})</option>
                {/each}
              </select>
            </div>
          {/if}

          <div>
            <label for="urnSlugInput" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
            <div class="flex items-stretch">
              <!-- The head is the memory's canonical `hrn:memory:<org>::` prefix
                   (see urnPrefix). It's empty for a non-canonical URN that lacks
                   a `::`, so the input just renders fully-rounded on its own. -->
              {#if urnPrefix}
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 font-mono text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{urnPrefix}</span>
              {/if}
              <input type="hidden" name="urnSlugPresent" value="true" />
              <!-- Lets the server skip URN recomposition unless the slug
                   actually changed (see the update action). -->
              <input type="hidden" name="originalUrnSlug" value={$settingsForm.originalUrnSlug} />
              <!-- The current full URN — the update action composes the
                   candidate URN from its `hrn:memory:<org>::` head to pre-check
                   for a collision before saving. -->
              <input type="hidden" name="currentUrn" value={$settingsForm.currentUrn} />
              <input id="urnSlugInput" name="urnSlug" type="text" bind:value={$settingsForm.urnSlug}
                aria-invalid={!!urnSlugError}
                aria-describedby={urnSlugError ? 'urnSlugError' : undefined}
                {...$settingsConstraints.urnSlug}
                class="w-full border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {urnPrefix ? 'rounded-r-lg' : 'rounded-lg'} {urnSlugError ? 'border-red-500 focus:border-red-500' : ''}" />
            </div>
            {#if urnSlugError}
              <p id="urnSlugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{urnSlugError}</p>
            {/if}
          </div>
        {/if}

        <div>
          <label for="shortDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Short description</label>
          <input id="shortDescription" name="shortDescription" type="text" bind:value={$settingsForm.shortDescription} class={inputClass} />
        </div>
        <div>
          <label for="description" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
          <textarea id="description" name="description" rows="3" bind:value={$settingsForm.description} class={inputClass}></textarea>
        </div>
        <div>
          <label for="tags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
          <input id="tags" name="tags" type="text" bind:value={$settingsForm.tags} class={inputClass} />
        </div>

        {#if !isAgentSystem}
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label for="category0" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
              <input id="category0" name="category0" type="text" bind:value={$settingsForm.category0} class={inputClass} />
            </div>
            <div>
              <label for="category1" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Subcategory</label>
              <input id="category1" name="category1" type="text" bind:value={$settingsForm.category1} class={inputClass} />
            </div>
            <div>
              <label for="category2" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-subcategory</label>
              <input id="category2" name="category2" type="text" bind:value={$settingsForm.category2} class={inputClass} />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="license" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">License</label>
              <input id="license" name="license" type="text" bind:value={$settingsForm.license} class={inputClass} />
            </div>
            <div>
              <label for="homeUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Home URL</label>
              <input id="homeUrl" name="homeUrl" type="url" bind:value={$settingsForm.homeUrl}
                aria-invalid={!!homeUrlError}
                aria-describedby={homeUrlError ? 'homeUrlError' : undefined}
                class="{inputClass} {homeUrlError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if homeUrlError}
                <p id="homeUrlError" class="mt-1 text-xs text-red-600 dark:text-red-400">{homeUrlError}</p>
              {/if}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="iconUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Icon URL</label>
              <input id="iconUrl" name="iconUrl" type="url" bind:value={$settingsForm.iconUrl}
                aria-invalid={!!iconUrlError}
                aria-describedby={iconUrlError ? 'iconUrlError' : undefined}
                class="{inputClass} {iconUrlError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if iconUrlError}
                <p id="iconUrlError" class="mt-1 text-xs text-red-600 dark:text-red-400">{iconUrlError}</p>
              {/if}
            </div>
            <div>
              <label for="heroUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Hero image URL</label>
              <input id="heroUrl" name="heroUrl" type="url" bind:value={$settingsForm.heroUrl}
                aria-invalid={!!heroUrlError}
                aria-describedby={heroUrlError ? 'heroUrlError' : undefined}
                class="{inputClass} {heroUrlError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if heroUrlError}
                <p id="heroUrlError" class="mt-1 text-xs text-red-600 dark:text-red-400">{heroUrlError}</p>
              {/if}
            </div>
          </div>
          <!-- Spec 034: visibility is meaningful only for knowledge (PUBLIC vs
               ORG). group is structurally GROUP; owner-only (personal/private)
               has no visibility. -->
          {#if g.class === 'knowledge'}
            <div>
              <label for="visibility" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
              <select id="visibility" name="visibility" bind:value={$settingsForm.visibility} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="ORGANIZATION">Organization</option>
                <option value="PUBLIC">Public</option>
              </select>
            </div>
          {/if}
        {/if}

        <div class="flex gap-3">
          <button type="submit" disabled={$settingsSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {$settingsSubmitting ? 'Saving...' : 'Save'}
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
            <span class="text-sm text-zinc-500">{isOwnerOnly ? 'Access' : 'Visibility'}</span>
            <span class="text-sm font-medium text-zinc-900 dark:text-white">
              {#if isOwnerOnly}Only you{:else}{(g.visibility && visibilityLabel[g.visibility]) ?? g.visibility ?? '—'}{/if}
            </span>
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
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Created</span>
          <span class="text-sm text-zinc-900 dark:text-white">{new Date(g.createdAt).toLocaleDateString()}</span>
        </div>
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
        <form method="POST" action="?/delete" use:kitEnhance class="flex items-center gap-2">
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
