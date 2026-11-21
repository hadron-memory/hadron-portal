<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { onMount, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import type { Infer } from 'sveltekit-superforms';
  import { addMarketplaceMemoryToAgentSchema } from './schema';
  import type { ActionData, PageData } from './$types';
  import type { MarketplaceRef } from './+page.server';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type AddToAgentForm = Infer<typeof addMarketplaceMemoryToAgentSchema, 'zod4'>;

  let search = $state('');

  // #687 — a failed catalogue read is NOT an empty marketplace.
  const loadFailed = $derived(data.loadFailed === true);

  const q = $derived(search.trim().toLowerCase());
  const matches = (r: MarketplaceRef) =>
    !q || r.name.toLowerCase().includes(q) || r.urn.toLowerCase().includes(q);
  const orgs = $derived(data.organizations.items.filter(matches));
  const agents = $derived(data.agents.items.filter(matches));
  const memories = $derived(data.memories.items.filter(matches));
  const anyResults = $derived(orgs.length + agents.length + memories.length > 0);

  // #685 — the adopt CTA. Each card owns its OWN <form> carrying a STATIC
  // `memoryId`, and the shared agent picker is mirrored into a hidden field.
  //
  // The obvious shape — one form for the whole grid, with a per-card button
  // that writes `memory.id` into a Superforms store on click — is broken, and
  // @codex's P1 on this PR is what caught it. A click handler and the submit it
  // triggers run in the SAME task, so Svelte has not flushed the store into the
  // bound hidden input by the time the form serializes: the first click submits
  // an empty id and later ones submit the PREVIOUS card's. No SSR test can see
  // it, because SSR never clicks.
  //
  // What makes this version safe is that nothing is written during the click.
  // `memoryId` is a literal in the markup, and `selectedAgentId` only ever
  // changes from a different interaction on a different element, so it is
  // always flushed before any button is pressed.
  //
  // That costs the client-side Superforms enhancement, and the page is better
  // for it: the action works with no JavaScript at all, which is the right
  // default for a catalogue. The server still validates through `superValidate`.
  //
  // portal#2398: kit's own `use:enhance` is added on top of that. It is progressive, so the plain
  // POST above still works with no JavaScript, and it is NOT Superforms' client store, so the
  // click-time hazard does not come back. With JavaScript the result lands in this document, in
  // the success region the card already rendered empty (a region inserted already populated is not
  // announced). Without JavaScript the result page is a fresh document, so the success box is
  // marked to take focus on load instead.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });
  // Keep the picker: `reset` would put every hidden `agentId` back to its first-render value.
  const keepForm = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: false });
  };
  const submitted = $derived(submittedForm<AddToAgentForm>(form, 'addToAgent'));
  const submittedMemoryId = $derived(submitted?.data.memoryId ?? null);
  const addToAgentError = $derived(
    scopedActionError<AddToAgentForm>(form, 'addToAgent', submitted?.message, submitted?.errors, [
      'agentId',
      'memoryId',
      '_kind',
    ])
  );
  const addToAgentSuccess = $derived(
    scopedActionSuccess<AddToAgentForm>(form, 'addToAgent', submitted?.message)
  );

  const adoptTargets = $derived(data.adoptTargets);
  const adoptTargetsFailed = $derived(data.adoptTargetsFailed === true);
  const canAdopt = $derived(adoptTargets.length > 0);

  // Seeded from the submission so the choice survives the full-page POST —
  // otherwise adding a second memory means picking the agent again.
  // `untrack` because this SEEDS the control and does not track it: after the
  // first render the select belongs to the reader, and re-deriving it from
  // `form` would yank their choice back to the last submitted one.
  let selectedAgentId = $state(
    untrack(() => submittedForm<AddToAgentForm>(form, 'addToAgent')?.data.agentId ?? '')
  );
</script>

<svelte:head>
  <title>{t('marketplace.page.title', 'Browse Marketplace · Hadron')}</title>
</svelte:head>

{#snippet card(r: MarketplaceRef)}
  <div class="space-y-2">
    <p class="text-sm font-semibold text-indigo-600 dark:text-indigo-300">{r.name}</p>
    <p class="font-mono text-xs text-zinc-400 break-all">{r.urn}</p>
    {#if r.description}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{r.description}</p>
    {/if}
  </div>
{/snippet}

<div class="space-y-8">
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('marketplace.page.heading', 'Browse Marketplace')}</h1>
    <p class="mt-2 text-zinc-500 dark:text-zinc-400">{t('marketplace.page.description', 'Discover public organizations, agents, and knowledge memories.')}</p>
  </div>

  <div>
    <input
      type="text"
      placeholder={t('marketplace.search.placeholder', 'Search the marketplace...')}
      bind:value={search}
      class="w-full max-w-md rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
    />
  </div>

  {#if loadFailed}
    <!-- #687. Checked BEFORE the empty state: on failure every section is EMPTY,
         so `!anyResults` is true and "The marketplace is empty for now." would
         be the portal asserting a fact about the catalogue it could not read. -->
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-12 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('marketplace.load-failed', "Couldn't load the marketplace just now — this is a temporary error, not an empty catalogue. Try refreshing the page.")}
    </div>
  {:else if !anyResults}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      {search ? t('marketplace.empty.search', 'Nothing matches your search.') : t('marketplace.empty.catalogue', 'The marketplace is empty for now.')}
    </div>
  {/if}

  <!-- Organizations -->
  {#if orgs.length > 0}
    <section class="space-y-3">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('marketplace.section.organizations', 'Organizations')} <span class="ml-1 text-sm font-normal text-zinc-500">({data.organizations.total})</span></h2>
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each orgs as org (org.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {@render card(org)}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Agents -->
  {#if agents.length > 0}
    <section class="space-y-3">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('marketplace.section.agents', 'Agents')} <span class="ml-1 text-sm font-normal text-zinc-500">({data.agents.total})</span></h2>
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each agents as agent (agent.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {@render card(agent)}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Memories -->
  {#if memories.length > 0}
    <section class="space-y-3">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('marketplace.section.memories', 'Knowledge memories')} <span class="ml-1 text-sm font-normal text-zinc-500">({data.memories.total})</span></h2>
      <!-- #685 — restored with the capability, per the issue: this line is what
           the marketplace always promised and what the adopt CTA below does. -->
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('marketplace.section.memories.description', 'Grab a memory to give your AI agent instant expertise.')}</p>

      {#if adoptTargetsFailed}
        <!-- Not "you have no agents": that is a claim about the account, and
             the query that would establish it failed. -->
        <p role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {t('marketplace.adopt.targets-failed', "Couldn't load your agents just now, so there is nothing to add a memory to. Try refreshing the page.")}
        </p>
      {:else if canAdopt}
        <div class="max-w-md">
          <label for="marketplaceAdoptAgent" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
            {t('marketplace.adopt.agent-label', 'Add to agent')}
          </label>
          <!-- min-w-0 because a <select> is sized by its longest <option>, and
               these options carry a URN
               (hrn:node:hadronmemory.com:hadron-portal:review:content-sized-control-needs-min-w-0). -->
          <!-- @copilot: the picker's validation error renders under the
               submitted card, so without these a keyboard or screen-reader user
               gets no field-level signal that the agent choice is what failed.
               The error id is stable and derived from the submitted memory, so
               it points at the message that actually rendered. -->
          <select
            id="marketplaceAdoptAgent"
            bind:value={selectedAgentId}
            aria-invalid={addToAgentError ? 'true' : undefined}
            aria-describedby={addToAgentError ? `adopt-error-${submittedMemoryId}` : undefined}
            class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">{t('marketplace.adopt.agent-placeholder', 'Choose an agent…')}</option>
            {#each adoptTargets as target (target.id)}
              <!-- The URN, not just the name (@codex P2, and
                   hrn:node:hadronmemory.com:hadron-portal:review:render-urn): two of the caller's
                   agents may share a display name, and then identical-looking
                   options submit different ids. An <option> cannot host the
                   `Urn` component, so the URN goes in the text. -->
              <option value={target.id}>{target.name} — {target.urn}</option>
            {/each}
          </select>
        </div>
      {:else}
        <!-- Says what it checked. The picker lists the caller's OWN agents, so
             an org member with only org agents is not being told they have
             none — they are told where that control lives. -->
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          {t('marketplace.adopt.no-agents', 'You have no agents of your own yet. Create one to use a memory here — an org agent takes memories from its own page.')}
          <a href="/app/agents/new" class="text-indigo-600 underline dark:text-indigo-300">{t('marketplace.adopt.create-agent', 'Create an agent')}</a>
        </p>
      {/if}

      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each memories as memory (memory.id)}
          <div class="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            {@render card(memory)}

            {#if canAdopt}
              <div>
                <form method="POST" action="?/addToAgent" use:enhance={keepForm} class="space-y-2">
                  <input type="hidden" name="_kind" value="addToAgent" />
                  <!-- Static. Never written during the click that submits it. -->
                  <input type="hidden" name="memoryId" value={memory.id} />
                  <input type="hidden" name="agentId" value={selectedAgentId} />
                  <!-- @copilot: every card's button read "Add to agent", so a
                       screen-reader user navigating by control could not tell
                       which memory they were attaching — the surrounding card
                       text is not part of the button's accessible name. The
                       visible label stays short; the accessible one names the
                       memory. -->
                  <button
                    type="submit"
                    aria-label={t('marketplace.adopt.submit.named', 'Add {memory} to agent', { memory: memory.name })}
                    class="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    {t('marketplace.adopt.submit', 'Add to agent')}
                  </button>

                  {#if submittedMemoryId === memory.id && addToAgentError}
                    <p id="adopt-error-{memory.id}" role="alert" class="text-xs text-red-600 dark:text-red-400">{addToAgentError}</p>
                  {/if}
                </form>
                <!-- Outside the form and outside the card's flex gap: a plain div keeps the idle region
                     from becoming a gap item (portal#2375 placement rule). -->
                <LiveRegion>
                  {#if submittedMemoryId === memory.id && addToAgentSuccess}
                    <!-- svelte-ignore a11y_autofocus -->
                    <p tabindex="-1" autofocus={!hydrated} class="mt-2 text-xs text-green-700 outline-none dark:text-green-400">{addToAgentSuccess}</p>
                  {/if}
                </LiveRegion>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
