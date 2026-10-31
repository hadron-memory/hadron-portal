<!--
  portal#1497 (MCP cut R7a) — remove one subscriber. The row keeps its Remove
  trigger whatever the roster read said (a worker missing from the chooser may
  still be subscribed), and this panel — opened by that trigger, rendered above
  the table beside the Add control (portal#1502 review: a 278px confirmation
  does not fit the 120px Actions column; Cancel was clipped at 390 and 1280) —
  carries the confirmation and every result, one removal at a time.

  - The confirmation names the worker, with its Urn; the form carries its own
    id (`unsubscribe-<subscriptionId>`) so a late result attaches only to its
    subscription. The page disables every other row's trigger while a removal
    is in flight: a swallowed result is exactly the late-result bug this
    control exists to prevent.
  - The POST states the worker ref itself (hrn:node:hadronmemory.com:specs:cor:agt:080:20):
    no row shape, no "submitted value written on click".
  - After a commit the reload goes to the FIRST subscriber page (?after=
    dropped). A refresh that fails does not undo the write: the ticker refresh
    marker + this route's error boundary say it (#1462 pattern, ticker-scoped).
  - A SUBSCRIPTION_NOT_FOUND refusal (the stale-row case) reloads to the first
    page too — the copy says the list is back there, and issue #1497's
    acceptance 2 says it reloads — but through NO marker: the boundary note
    says "the write stands", and a refused write must never claim that
    (portal#1502 review: both seats found the missing reload; the no-marker
    rule is why this is not fence.begin).
  - "Removed" is the result, shown from the action result, never inferred from
    a reloaded list that a stale page could hide. The line renders as an
    empty live region from the panel's first paint, so the text that later
    lands in it is a change (portal#1502 review).
  - The result OUTLIVES the panel (portal#1502 delta seats): the reload a
    committed removal (or the stale-row refusal) performs drops the row, and
    the row is what keeps this panel mounted — so every outcome the reader
    must still see after that reload is handed to the PAGE through onOutcome,
    once the reload has settled. Escape closes only from inside the panel
    (a containment-scoped listener, so an Escape elsewhere on the page is not
    this panel's to answer), and one panel instance never carries one row's
    result into another row's confirmation (keyed reset on ticker AND
    subscription).
-->
<script lang="ts">
  import { onDestroy, tick as tickFn } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import TickerRefreshFailedLine from '$lib/components/tickers/TickerRefreshFailedLine.svelte';
  import {
    announcementFailedText,
    asTickerRefusal,
    asTickerSuccess,
    removedText,
    tickerFirstPageHref,
    type TickerRemoveOutcome,
  } from '$lib/tickers/controls';
  import { createTickerRefreshFence } from '$lib/tickers/refresh-fence';

  let {
    appId,
    ticker,
    subscription,
    worker,
    viewerId = null,
    onClose,
    onOutcome = () => {},
    busy = $bindable(false),
  }: {
    appId: string;
    ticker: { id: string; name: string };
    /** The row's own subscription: the form's id and the result's key. */
    subscription: { id: string };
    worker: { id: string; name: string | null; urn: string | null };
    viewerId?: string | null;
    /** Cancel/Escape: the page closes the panel and refocuses its trigger. */
    onClose: () => void;
    /**
     * A finished removal, reported once its reload has settled (so refreshFailed
     * is final). The outcome belongs to the page: the reload drops the row, the
     * row is what keeps this panel mounted, so the result is handed up to
     * wherever outlives it (portal#1502 delta seats, Gemma + Gaby).
     */
    onOutcome?: (outcome: TickerRemoveOutcome) => void;
    /** True while this panel's POST is in flight — the page mutes other rows. */
    busy?: boolean;
  } = $props();

  let submitting = $state(false);
  let ok = $state<string | null>(null);
  let announcementFailed = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let refreshFailed = $state(false);
  let shownFor = $state<string | null>(null);
  let generation = 0;

  let confirmButton: HTMLButtonElement | null = $state(null);

  const workerLabel = $derived(worker.name ?? worker.urn ?? worker.id);

  // A reused page (another ticker under the same route) or another row's panel
  // reuse resets every result: a result belongs to the subscription it was
  // written for. Keyed on ticker AND subscription — one panel instance must
  // never carry one row's refusal or result into another row's confirmation
  // (portal#1502 delta seats, Gaby + Uma).
  $effect.pre(() => {
    if (shownFor !== `${ticker.id}/${subscription.id}`) {
      generation++;
      submitting = false;
      busy = false;
      ok = null;
      announcementFailed = false;
      refusal = null;
      refreshFailed = false;
      shownFor = ticker.id;
    }
  });

  // Focus starts on the confirmation's own action, as Add does.
  $effect(() => {
    void shownFor;
    confirmButton?.focus({ preventScroll: true });
  });

  // Leaving the page ends this control's right to touch it — and nothing else: kit's error
  // route for a FAILED refresh unmounts this control, and its marker is what that route's
  // boundary needs (#1462 pattern; the still-mounted paths below clear it instead).
  onDestroy(() => {
    generation++;
    busy = false;
  });

  // The refresh fence, shared by every ticker control (#1497 review): it owns the
  // marker attempt (canonical id AND the route's spelling), cancels it on a
  // navigation that is not this control's own reload — the goto to the ticker's
  // FIRST subscriber page below IS that reload, so its marker survives it — and
  // rules whether the page's error is THIS refresh's failure. Only a COMMITTED
  // write opens it; the SUBSCRIPTION_NOT_FOUND reload below stays outside it.
  const fence = createTickerRefreshFence({
    appId: () => appId,
    tickerId: () => ticker.id,
    reloadHref: () => tickerFirstPageHref(appId, ticker.id),
  });

  // Escape closes the panel — only from INSIDE it (portal#1502 delta, Gaby,
  // thrice flagged): the listener is scoped by containment, so an Escape
  // anywhere else on the page leaves this confirmation alone. Focus returns
  // to the row's trigger (the page's job).
  let panel: HTMLDivElement | null = $state(null);
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || submitting) return;
    if (!(e.target instanceof Node) || !panel?.contains(e.target)) return;
    onClose();
  }

  function submit() {
    return ({ cancel }: { cancel: () => void }) => {
      if (submitting) {
        cancel();
        return;
      }
      const mine = ++generation;
      // Captured before any await: the reload below can drop the row and
      // unmount this panel MID-FLIGHT (the page's row-gone effect runs during
      // the goto), after which this component's props read as null — a
      // continuation may not reach back through them (portal#1502 delta).
      const subId = subscription.id;
      const workerId = worker.id;
      const reloadHref = tickerFirstPageHref(appId, ticker.id);
      submitting = true;
      busy = true;
      ok = null;
      announcementFailed = false;
      refusal = null;
      refreshFailed = false;
      return async ({ result }: { result: { type: string; data?: unknown } }) => {
        if (mine !== generation) return;
        submitting = false;
        busy = false;
        if (result.type === 'success') {
          const success = asTickerSuccess(result.data);
          // A result names WHAT it was about: only this row's own unsubscribe,
          // for the worker this row names, decorates this panel.
          const ownRow = success?.action === 'unsubscribe' && success.target === workerId;
          if (ownRow) {
            // ok is the "this row was removed" gate; ownRow implies the result's
            // target IS this row's worker, whose ref is already a string here.
            ok = workerId;
            announcementFailed = success.announcementFailed === true;
          }
          // The reload starts at the FIRST subscriber page (?after= dropped). A
          // failure to reload does not undo the write: in the real kit it does not
          // even reject — it navigates to this route's error boundary and unmounts
          // this control (#1462 pattern), so the marker is left just before it and
          // cleared here only while this panel is still mounted.
          const attempt = fence.begin(viewerId, 'unsubscribe', workerId);
          let reloadFailed = false;
          try {
            await goto(reloadHref, { invalidateAll: true });
          } catch {
            refreshFailed = true;
            reloadFailed = true;
          }
          fence.refreshSettled(attempt);
          if (ownRow) {
            // Reported BEFORE the unmount check: the reload above drops the row,
            // the row is what keeps this panel mounted, so the outcome is the
            // page's to show — with or without this instance (portal#1502 delta).
            onOutcome({ subscriptionId: subId, text: removedText(), announcementFailed, refreshFailed: reloadFailed });
          }
          if (mine !== generation) {
            // Unmounted during the reload. The marker survives only when the failure
            // was THIS reload's (this ticker's error page); anything else may not
            // claim a failed reload later.
            if (!fence.failedHere(attempt)) fence.clear(attempt);
            return;
          }
          fence.clear(attempt);
          return;
        }
        refusal = result.type === 'failure' ? asTickerRefusal(result.data) : { kind: 'uncertain' };
        // The stale-row case (portal#1502 review): the server says this
        // subscription already ended, so the row is stale and the copy says the
        // list is back at its first page — make that true, without a marker (a
        // refused write must never claim "the write stands" on the boundary).
        if (refusal.kind === 'refused' && refusal.code === 'SUBSCRIPTION_NOT_FOUND') {
          // Read before the await: the sentence is the server's own, and the
          // state it came from may not survive the reload's state changes.
          const staleMessage = refusal.message;
          let reloadFailed = false;
          try {
            await goto(reloadHref, { invalidateAll: true });
          } catch {
            refreshFailed = true;
            reloadFailed = true;
          }
          // The same reload drops the stale row and unmounts this panel with it,
          // so its sentence — the one that says where the list went — is the
          // page's to keep showing (portal#1502 delta).
          onOutcome({ subscriptionId: subId, text: staleMessage, announcementFailed: false, refreshFailed: reloadFailed });
        }
        // Any other refusal keeps the confirmation open (as Add keeps its draft):
        // the reader can retry by hand or cancel.
      };
    };
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div bind:this={panel} id={"ticker-remove-panel-" + subscription.id} class="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60" data-testid={"ticker-remove-confirm-" + subscription.id} role="group" aria-label={t('app.ticker.controls.remove.panel', 'Remove a subscriber')}>
  {#if ok === null}
    <form
      id={"unsubscribe-" + subscription.id}
      method="POST"
      action="?/unsubscribe"
      use:enhance={submit()}
      class="space-y-2"
    >
      <!-- The POST states the worker ref itself. -->
      <input type="hidden" name="worker" value={worker.id} />
      <!-- break-words: a nameless worker's label IS its URN — a 200-character
           unbreakable word that otherwise spills the panel (portal#1502 review:
           the same sentence clipped inside the Actions column at the old head). -->
      <p class="break-words text-zinc-900 dark:text-white">
        {t('app.ticker.controls.remove.confirm', 'Remove {name} from this ticker? It stops being woken by it.', { name: workerLabel })}
      </p>
      {#if worker.urn}<Urn value={worker.urn} size={9} compact />{/if}
      <div class="flex flex-wrap items-center gap-2">
        <button
          bind:this={confirmButton}
          type="submit"
          disabled={submitting}
          class="rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        >{submitting ? t('app.ticker.controls.remove.submitting', 'Removing…') : t('app.ticker.controls.remove.confirm-button', 'Remove')}</button>
        <button
          type="button"
          disabled={submitting}
          onclick={onClose}
          class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >{t('app.ticker.controls.remove.cancel', 'Cancel')}</button>
      </div>
    </form>
  {:else}
    <!-- The result itself lives in the live region below — one line, not two. -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onclick={onClose}
        class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >{t('app.ticker.controls.remove.cancel', 'Cancel')}</button>
    </div>
  {/if}
  <!-- An always-present empty live region: the text that lands in it is a change
       (portal#1502 review), so the result line is announced, not swapped in. -->
  <p role="status" class="text-sm text-zinc-900 dark:text-white" data-testid={"ticker-remove-result-" + subscription.id}>{ok !== null ? removedText() : ''}</p>
  {#if announcementFailed}<span role="status" class="text-xs text-amber-800 dark:text-amber-300" data-testid={"ticker-remove-announcement-" + subscription.id}>{announcementFailedText()}</span>{/if}
  {#if refreshFailed}<span class="block"><TickerRefreshFailedLine testid={"ticker-remove-refresh-failed-" + subscription.id} /></span>{/if}
  {#if refusal}<WriteRefusalAlert {refusal} />{/if}
</div>
