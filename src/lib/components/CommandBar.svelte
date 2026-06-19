<script lang="ts">
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import {
    COMMAND_MODES,
    buildCommandRoute,
    type CommandModeId,
    type UrnResolution,
  } from './command-bar';

  // `dark` is threaded from Nav (not read off the html `.dark` class) so the
  // bar themes correctly during SSR, exactly like the rest of the nav chrome.
  let { dark = true }: { dark?: boolean } = $props();

  let mode = $state<CommandModeId>('open');
  let value = $state('');
  let activated = $state(false); // input/select has focus → "white" look
  let busy = $state(false);
  let error = $state('');

  const placeholder = $derived(
    COMMAND_MODES.find((m) => m.id === mode)?.placeholder ?? ['', ''],
  );

  /** Resolve a parent URN → PK via the JSON sibling of the #262 resolver. */
  async function resolveUrn(urn: string): Promise<UrnResolution | null> {
    try {
      const res = await fetch(`/app/u/resolve?urn=${encodeURIComponent(urn)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { resolution?: UrnResolution | null };
      return data.resolution ?? null;
    } catch {
      return null;
    }
  }

  async function run() {
    if (busy || !value.trim()) return;
    busy = true;
    error = '';
    try {
      const route = await buildCommandRoute(mode, value, resolveUrn);
      if (route.ok) {
        await goto(route.path);
      } else {
        error = route.error;
      }
    } finally {
      busy = false;
    }
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    run();
  }

  // Changing the mode invalidates whatever error the prior mode produced.
  function onModeChange() {
    error = '';
  }
</script>

<form onsubmit={onSubmit} class="w-full">
  <!-- One fused control: mode dropdown (left) + input (right), like VS Code's
       command box but with the selector on the left. Muted gray at rest; flips
       to a "white"/activated look on focus (no popup, per #320). -->
  <div
    onfocusin={() => (activated = true)}
    onfocusout={() => (activated = false)}
    class="flex items-stretch overflow-hidden rounded-md border transition-colors
      {activated
        ? dark
          ? 'border-zinc-500 bg-zinc-900 ring-1 ring-zinc-500'
          : 'border-zinc-400 bg-white ring-1 ring-zinc-300'
        : dark
          ? 'border-zinc-700 bg-zinc-800/70'
          : 'border-zinc-200 bg-zinc-100'}"
  >
    <div class="relative flex items-center">
      <select
        bind:value={mode}
        onchange={onModeChange}
        aria-label={t('app.commandbar.mode-label', 'Command mode')}
        class="h-full appearance-none bg-transparent py-1.5 pl-3 pr-7 text-sm font-medium focus:outline-none
          {dark ? 'text-zinc-300' : 'text-zinc-600'}"
      >
        {#each COMMAND_MODES as m}
          <option value={m.id} class={dark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'}>
            {t(m.label[0], m.label[1])}
          </option>
        {/each}
      </select>
      <svg
        aria-hidden="true"
        class="pointer-events-none absolute right-2 h-3 w-3 {dark ? 'text-zinc-500' : 'text-zinc-400'}"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>

    <span class="my-1.5 w-px shrink-0 {dark ? 'bg-zinc-700' : 'bg-zinc-300'}"></span>

    <input
      bind:value
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      disabled={busy}
      placeholder={t(placeholder[0], placeholder[1])}
      class="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm focus:outline-none
        {dark ? 'text-zinc-100 placeholder-zinc-500' : 'text-zinc-900 placeholder-zinc-400'}"
    />
  </div>

  {#if error}
    <!-- Absolutely positioned so the inline error never reflows the nav row. -->
    <p
      class="absolute z-10 mt-1 max-w-md rounded-md border px-2 py-1 text-xs shadow-sm
        {dark
          ? 'border-red-900/50 bg-red-950 text-red-300'
          : 'border-red-200 bg-red-50 text-red-700'}"
    >
      {error}
    </p>
  {/if}
</form>
