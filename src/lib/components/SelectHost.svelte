<script lang="ts">
  // portal#2311 — pick the one host an App key may operate (host:operate).
  //
  // Presentational: the dialog that owns the pick also owns the read (it is
  // fetched when the dialog opens and is one App's, one reader's answer), so
  // this component renders whichever state that read is in. It is inline, not a
  // second modal: the Grant-scope dialog is a native <dialog> in the top layer,
  // which a fixed-position picker could not stack above, and a choice of one
  // host among an App's few is a radio group, not a browse list.
  //
  // A host has no URN (its id is "within its App"), so the id shows as a copyable
  // code chip rather than the Urn component, which would parse it as an entity.
  import { t } from '$lib/i18n/t';
  import type { AppHost } from '$lib/server/app-hosts';
  import LiveRegion from './LiveRegion.svelte';

  export type HostsState = { kind: 'loading' } | { kind: 'refused' } | { kind: 'failed' } | { kind: 'ok'; hosts: AppHost[] };

  let {
    state,
    value = $bindable(''),
    held = null,
    name = 'hostId',
    describedby,
    onretry,
  }: {
    state: HostsState;
    value?: string;
    /** The host this key already operates, if any: shown read-only when it is not among the registrations. */
    held?: string | null;
    name?: string;
    describedby?: string;
    onretry: () => void;
  } = $props();

  const legend = $derived(t('select-host.label', 'Host'));
  const unknownHeld = $derived(
    held && state.kind === 'ok' && !state.hosts.some((h) => h.hostId === held) ? held : null,
  );
</script>

<!-- portal#2344: the region that says "loading", "refused" or "empty" is always
     mounted and only its content comes and goes, so the change is announced. -->
<LiveRegion>
  {#if state.kind === 'loading'}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('select-host.loading', 'Loading hosts…')}</p>
  {:else if state.kind === 'refused'}
    <p data-testid="select-host-refused" class="text-sm text-zinc-700 dark:text-zinc-300">
      {t('select-host.refused', "You can't see this App's hosts")}
    </p>
  {:else if state.kind === 'ok' && state.hosts.length === 0 && !unknownHeld}
    <p data-testid="select-host-empty" class="text-sm text-zinc-700 dark:text-zinc-300">
      {t('select-host.empty', 'No hosts are registered for this App')}
      <span class="mt-1 block text-xs text-zinc-500">{t('select-host.empty-help', 'A host registers itself with this App’s key.')}</span>
    </p>
  {/if}
</LiveRegion>
{#if state.kind === 'failed'}
  <div data-testid="select-host-failed" class="flex flex-wrap items-center gap-3">
    <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('select-host.failed', 'The hosts could not be loaded.')}</p>
    <button type="button" onclick={onretry} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600">
      {t('select-host.retry', 'Retry')}
    </button>
  </div>
{:else if state.kind === 'ok' && (state.hosts.length > 0 || unknownHeld)}
  <fieldset aria-describedby={describedby} class="min-w-0 space-y-2">
    <legend class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{legend}</legend>
    {#each state.hosts as host (host.hostId)}
      <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm has-checked:border-indigo-500 dark:border-zinc-700">
        <input type="radio" {name} value={host.hostId} bind:group={value} class="mt-1" />
        <span class="min-w-0 flex-1">
          <span class="block font-medium text-zinc-900 dark:text-white">{host.label}</span>
          <code class="mt-0.5 block break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">{host.hostId}</code>
        </span>
        <span class="flex shrink-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <span aria-hidden="true" class="h-2 w-2 rounded-full {host.live ? 'bg-emerald-500' : 'bg-zinc-400'}"></span>
          {host.live ? t('select-host.live', 'Live') : t('select-host.offline', 'Offline')}
        </span>
      </label>
    {/each}
    {#if unknownHeld}
      <p data-testid="select-host-unknown" class="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-700 dark:border-zinc-600 dark:text-zinc-300">
        {t('select-host.unknown', 'Unknown host')}
        <code class="font-mono text-xs">{unknownHeld}</code>
      </p>
    {/if}
  </fieldset>
{/if}
