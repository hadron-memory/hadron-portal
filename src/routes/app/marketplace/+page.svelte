<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { Infer, SuperValidated } from 'sveltekit-superforms';
  import { addMarketplaceMemoryToAgentSchema } from './schema';
  import type { ActionData, PageData } from './$types';
  import type { MarketplaceRef } from './+page.server';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type AddToAgentForm = Infer<typeof addMarketplaceMemoryToAgentSchema, 'zod4'>;
  type AddToAgentSuperform = SuperValidated<AddToAgentForm, App.Superforms.Message, AddToAgentForm>;

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

  // #685 — the adopt CTA. One form serves the whole memories grid: the target
  // agent is chosen once and each card's button submits that card's memory id.
  // A per-card <select> would ask the same question once per row.
  const initialAddToAgentForm = untrack(
    () => (submittedForm<AddToAgentForm>(form, 'addToAgent') as AddToAgentSuperform | null) ?? data.addToAgentForm
  );
  const {
    form: addToAgentForm,
    submitting: addToAgentSubmitting,
    enhance: addToAgentEnhance,
  } = superForm<AddToAgentForm, App.Superforms.Message, AddToAgentForm>(initialAddToAgentForm, {
    validators: zod4Client(addMarketplaceMemoryToAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // The banner is scoped to the memory the action actually ran against, not to
  // the page: the submitted form carries its own `memoryId`, so a success or a
  // refusal is rendered against the card that produced it rather than beside
  // whichever card happens to be first.
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

      <form method="POST" action="?/addToAgent" use:addToAgentEnhance class="space-y-4" novalidate>
        <input type="hidden" name="_kind" value={$addToAgentForm._kind} />
        <input type="hidden" name="memoryId" value={$addToAgentForm.memoryId} />

        {#if adoptTargetsFailed}
          <!-- Not "you have no agents": that is a claim about the account, and
               the query that would establish it failed. -->
          <p role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            {t('marketplace.adopt.targets-failed', "Couldn't load your agents just now, so there is nothing to add a memory to. Try refreshing the page.")}
          </p>
        {:else if canAdopt}
          <div class="flex max-w-md items-end gap-2">
            <div class="min-w-0 flex-1">
              <label for="marketplaceAdoptAgent" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                {t('marketplace.adopt.agent-label', 'Add to agent')}
              </label>
              <select
                id="marketplaceAdoptAgent"
                name="agentId"
                bind:value={$addToAgentForm.agentId}
                class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              >
                <option value="">{t('marketplace.adopt.agent-placeholder', 'Choose an agent…')}</option>
                {#each adoptTargets as target (target.id)}
                  <option value={target.id}>{target.name}</option>
                {/each}
              </select>
            </div>
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
                <div class="space-y-2">
                  <button
                    type="submit"
                    disabled={$addToAgentSubmitting}
                    onclick={() => addToAgentForm.update((current) => ({ ...current, memoryId: memory.id }), { taint: false })}
                    class="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {t('marketplace.adopt.submit', 'Add to agent')}
                  </button>

                  {#if submittedMemoryId === memory.id && addToAgentError}
                    <p role="alert" class="text-xs text-red-600 dark:text-red-400">{addToAgentError}</p>
                  {/if}
                  {#if submittedMemoryId === memory.id && addToAgentSuccess}
                    <p role="status" class="text-xs text-green-700 dark:text-green-400">{addToAgentSuccess}</p>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </form>
    </section>
  {/if}
</div>
