<!--
  portal#1497 (MCP cut R7a) — turn this ticker on or off. One control; the POST
  states the DESIRED value of `enabled` (rendered as a literal from the state
  the page loaded, never a toggle written on click), and the action proves the
  server's echo equals it before calling it a success.

  - Who may: the server's call (hrn:node:hadronmemory.com:specs:cor:agt:080:18 — the page's
    `app.ticker.who` line above states the rule); the refusal answers anyone else.
  - Turning off never removes anyone (cor:agt:080:06): the copy says so, and the
    subscriber list below is untouched by this control.
  - An uncertain outcome is shown as such and never retried; a committed write
    whose refresh fails says "Saved; the page couldn't reload" (the ticker
    refresh marker + this route's error boundary carry it).
  - The action URL keeps the page's own `?after=` slice, so a native POST
    reloads the view it came from.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { enhance } from '$app/forms';
  import { beforeNavigate, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import TickerRefreshFailedLine from '$lib/components/tickers/TickerRefreshFailedLine.svelte';
  import { tickerOfPage } from '$lib/tickers/refresh-page';
  import { asTickerRefusal, asTickerSuccess } from '$lib/tickers/controls';
  import { clearTickerRefreshMarker, setTickerRefreshMarker } from '$lib/tickers/ticker-refresh-marker';

  let {
    appId,
    ticker,
    after = null,
    viewerId = null,
    impersonating = null,
  }: {
    appId: string;
    ticker: { id: string; enabled: boolean };
    /** The subscriber page's cursor, when the page is on a later one; a native POST keeps its slice. */
    after?: string | null;
    viewerId?: string | null;
    impersonating?: string | null;
  } = $props();

  let submitting = $state(false);
  let ok = $state<'on' | 'off' | null>(null);
  let refusal = $state<WriteRefusal | null>(null);
  let refreshFailed = $state(false);
  let shownFor = $state<string | null>(null);
  let generation = 0;

  // A reused page (another ticker under the same route) resets every result:
  // a result belongs to the ticker it was written for, keyed on its id.
  $effect.pre(() => {
    if (shownFor !== ticker.id) {
      generation++;
      submitting = false;
      ok = null;
      refusal = null;
      refreshFailed = false;
      shownFor = ticker.id;
    }
  });

  // Leaving the page ends this control's right to touch it — and nothing else:
  // kit's error route for a FAILED refresh unmounts this control too, and its
  // marker is exactly what that route's boundary needs, so onDestroy must NOT
  // clear it (#1462 pattern; the still-mounted paths below clear it instead).
  onDestroy(() => {
    generation++;
  });

  // This control's attempt while its refresh is in flight. `invalidateAll` fires no
  // beforeNavigate; a real navigation does, and it is what cancels the refresh, so
  // the marker goes then. Only this attempt's marker is touched.
  let pendingAttempt: string | null = null;
  beforeNavigate(() => {
    if (pendingAttempt) clearTickerRefreshMarker(pendingAttempt);
    pendingAttempt = null;
  });

  // Whether the page store is showing this ticker's ERROR page: the refresh's own
  // failure, as opposed to a destination that failed on its own.
  function failedHere(): boolean {
    const p = get(page);
    const at = tickerOfPage(p);
    return p.error !== null && at !== null && at.appId === appId && at.tickerId === ticker.id;
  }

  const actionHref = $derived(`?/set-enabled${after ? `&after=${encodeURIComponent(after)}` : ''}`);

  function submit() {
    return ({ cancel }: { cancel: () => void }) => {
      if (submitting) {
        cancel();
        return;
      }
      const mine = ++generation;
      submitting = true;
      ok = null;
      refusal = null;
      refreshFailed = false;
      return async ({ result }: { result: { type: string; data?: unknown } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          const success = asTickerSuccess(result.data);
          if (success) ok = success.enabled === true ? 'on' : 'off';
          // The refresh below reloads the page's own view. A failure to refresh
          // does not undo the write: in the real kit it does not even reject — it
          // navigates to this route's error boundary and unmounts this control
          // (#1462 pattern), so the marker is left just before it and cleared
          // here only while this control is still the one showing.
          const attempt = viewerId
            ? setTickerRefreshMarker({ viewer: viewerId, appId, tickerId: ticker.id, action: ticker.enabled ? 'disable' : 'enable', targetWorkerId: null })
            : null;
          pendingAttempt = attempt;
          try {
            await invalidateAll();
          } catch {
            refreshFailed = true;
          }
          if (pendingAttempt === attempt) pendingAttempt = null;
          if (mine !== generation) {
            // Unmounted during the refresh. The marker survives only when the
            // failure was THIS refresh's (this ticker's error page); anything
            // else may not claim a failed reload later.
            if (attempt && !failedHere()) clearTickerRefreshMarker(attempt);
            return;
          }
          if (attempt) clearTickerRefreshMarker(attempt);
          return;
        }
        refusal = result.type === 'failure' ? asTickerRefusal(result.data) : { kind: 'uncertain' };
      };
    };
  }
</script>

{#if impersonating}
  <p class="text-xs text-zinc-500 dark:text-zinc-400">
    {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating })}
  </p>
{:else}
  <div class="space-y-2" data-testid="ticker-enabled-control">
    <form method="POST" action={actionHref} use:enhance={submit()} class="flex flex-wrap items-center gap-2">
      <!-- The DESIRED value as a literal: enabled says "Turn off" (post false), disabled says "Turn on" (post true). -->
      <input type="hidden" name="enabled" value={ticker.enabled ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={submitting}
        class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >{submitting
        ? (ticker.enabled ? t('app.ticker.controls.turning-off', 'Turning off…') : t('app.ticker.controls.turning-on', 'Turning on…'))
        : (ticker.enabled ? t('app.ticker.controls.turn-off', 'Turn off') : t('app.ticker.controls.turn-on', 'Turn on'))}</button>
      {#if ticker.enabled}
        <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.ticker.controls.off-keeps', 'Turning it off keeps its subscribers; it wakes no one while it is off.')}</span>
      {/if}
      <span role="status" class="sr-only" data-testid="ticker-enabled-result">
        {#if ok === 'on'}{t('app.ticker.controls.turned-on', 'Turned on.')}{:else if ok === 'off'}{t('app.ticker.controls.turned-off', 'Turned off. Its subscribers are kept.')}{/if}
      </span>
    </form>
    {#if refusal}<WriteRefusalAlert {refusal} />{/if}
    {#if refreshFailed}<TickerRefreshFailedLine />{/if}
  </div>
{/if}
