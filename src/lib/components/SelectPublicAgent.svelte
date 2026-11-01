<script lang="ts">
  /**
   * "Select Public Agent" — the agent-specialized sibling of
   * ElementSelector (#486): same modal + bindable `open` + `onselect`
   * contract, but agent-shaped rows (owner-org badge derived from the
   * URN instead of a node-type badge, URN as the secondary line) and
   * search across name / URN / description.
   *
   * Fed by the publicAgents marketplace slice (hadron-server#551/#552);
   * the caller pre-filters out its own org's agents and existing
   * subscriptions.
   */
  import { t } from '$lib/i18n/t';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';

  export type PublicAgentPick = {
    id: string;
    urn: string;
    name: string;
    description?: string | null;
    organizationId: string;
  };

  let {
    agents,
    onselect,
    open = $bindable(false),
  }: {
    agents: PublicAgentPick[];
    onselect: (agent: PublicAgentPick) => void;
    open?: boolean;
  } = $props();

  let query = $state('');

  /** Owning org's slug out of a canonical agent URN (hrn:agent:<org>::<slug>). */
  function ownerSlugOf(urn: string): string {
    const bare = urn.replace(/^(hrn|urn):agent:/, '');
    const sep = bare.indexOf('::');
    return sep >= 0 ? bare.slice(0, sep) : bare;
  }

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const results = q
      ? agents.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.urn.toLowerCase().includes(q) ||
            (a.description ?? '').toLowerCase().includes(q),
        )
      : agents;
    return results.slice(0, 20);
  });

  function select(agent: PublicAgentPick) {
    onselect(agent);
    open = false;
    query = '';
  }

  // The Select-family Escape pattern (#1582/#1584): Escape pressed INSIDE the
  // panel is consumed at the panel layer, so a host whose own window listener
  // registered first cannot close with us on one keypress; the window
  // fallback (the shared CAPTURE helper, with the consumed-key and IME
  // guards) owns the key only for a focus that never entered the panel.
  const escapeFallback = { close: () => { open = false; } };
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onclick={() => { open = false; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => consumeEscapeAtDialog(e, escapeFallback)}
      use:dialogEscapeFallback={escapeFallback}
    >
      <div class="border-b border-zinc-200 p-3 dark:border-zinc-700">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={query}
          placeholder={t('select-public-agent.placeholder', 'Search public agents...')}
          autofocus
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
      </div>
      <div class="max-h-64 overflow-y-auto">
        {#if filtered.length === 0}
          <div class="px-4 py-6 text-center text-sm text-zinc-500">
            {agents.length === 0
              ? t('select-public-agent.none', 'No public agents available to subscribe to.')
              : t('select-public-agent.no-matches', 'No matches found.')}
          </div>
        {:else}
          {#each filtered as agent (agent.id)}
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onclick={() => select(agent)}
            >
              <span class="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                {ownerSlugOf(agent.urn)}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-zinc-900 dark:text-white">{agent.name}</p>
                <p class="truncate font-mono text-xs text-zinc-400">{agent.urn}</p>
                {#if agent.description}
                  <p class="truncate text-xs text-zinc-400">{agent.description}</p>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
      <div class="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-700">
        {filtered.length} {filtered.length === 1 ? t('select-public-agent.result', 'result') : t('select-public-agent.results', 'results')} · {t('select-public-agent.esc', 'Esc to close')}
      </div>
    </div>
  </div>
{/if}
