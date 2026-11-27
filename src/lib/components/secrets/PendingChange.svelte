<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { t } from '$lib/i18n/t';
  import { isOpenState, requestStateText } from '$lib/secrets/staged';
  import { fmtRunTime } from '$lib/flow/runs';

  /**
   * portal#2380 — a change that waits for the person's passkey signature. The link goes to the
   * server's own page; the portal never completes the ceremony. The state is a read made when
   * the page loaded; while the request is open it is read again whenever the person comes back
   * to this tab (they sign in another one), so it never keeps offering Withdraw for a change
   * that was applied meanwhile.
   * portal#2417 — the link is rebuilt from the portal's configured origin; when there is none
   * (`ceremonyUrl` null) no link is offered at all, never a guess.
   * portal#2583 — this row is the notice on a later visit too, so its unlinked hint says the change
   * still waits (its own key; `secrets.write.staged-unlinked` stays the staging-time sentence of a refused write).
   */
  let { requestId, secretId = null, ceremonyUrl, state: requestState, operation, expiresAt, secretName = null, impersonating = false, action = '?/withdraw', reread: readAgain = () => invalidateAll(), focusFallback = 'h1' }: {
    requestId: string; secretId?: string | null; ceremonyUrl: string | null; state: string; operation: string; expiresAt: string; secretName?: string | null; impersonating?: boolean;
    /** The form action that withdraws; a host that is not the secret's own page names its own. */
    action?: string;
    /** Reads the host's data again: after a withdraw, and when the person comes back to this tab. Defaults to the page load. */
    reread?: () => Promise<unknown>;
    /** Where focus lands when a withdrawn request's notice is gone. */
    focusFallback?: string;
  } = $props();
  const open = $derived(isOpenState(requestState));
  let root: HTMLElement | undefined;
  // A re-read that failed leaves the notice as it was, so say that: the state shown is the last one seen.
  let rereadFailed = $state(false);

  onMount(() => {
    let alive = true;
    let reading = false;
    const reread = () => {
      // Coming back to a tab fires focus and visibilitychange together: one read for both.
      if (!alive || !open || reading || document.visibilityState === 'hidden') return;
      reading = true;
      void readAgain().then(() => { if (alive) rereadFailed = false; }, () => { if (alive) rereadFailed = true; }).finally(() => { reading = false; });
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => {
      alive = false;
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  });
  const opText = $derived.by(() => {
    switch (operation.toUpperCase()) {
      case 'STORE': return t('secrets.request.op.store', 'a new value');
      case 'DELETE': return t('secrets.request.op.delete', 'deleting this secret');
      case 'CREATE': return t('secrets.request.op.create', 'creating this secret');
      case 'SET_PROTECTED': return t('secrets.request.op.protect', 'turning protection on');
      case 'CLEAR_PROTECTED': return t('secrets.request.op.unprotect', 'turning protection off');
      case 'SET_DELETE_AFTER_USE': return t('secrets.request.op.delete-after-use-on', 'turning delete after use on');
      case 'CLEAR_DELETE_AFTER_USE': return t('secrets.request.op.delete-after-use-off', 'turning delete after use off');
      default: return operation;
    }
  });
</script>

<div bind:this={root} tabindex="-1" class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950" data-testid="pending-change">
  {#if secretName}<p class="font-mono text-xs text-amber-800 dark:text-amber-300">{secretName}</p>{/if}
  <p class="font-medium text-amber-900 dark:text-amber-100">{requestStateText(requestState)}</p>
  <p class="mt-1 text-amber-900 dark:text-amber-200">
    {#if open}
      {t('secrets.request.waiting', 'Pending: {op}. Nothing has been saved yet.', { op: opText })}
    {:else}
      {t('secrets.request.ended', 'This request was for {op}.', { op: opText })}
    {/if}
  </p>
  {#if open}
    <LiveRegion data-testid="reread-status">
      {#if rereadFailed}
        <p class="mt-1 text-xs text-red-700 dark:text-red-400" data-testid="reread-failed">{t('secrets.request.reread-failed', "Couldn't check whether this has been signed. What's shown was true when you last looked.")}</p>
      {/if}
    </LiveRegion>
    <p class="mt-1 text-xs text-amber-800 dark:text-amber-300">{t('secrets.request.expires', 'Expires {time}', { time: fmtRunTime(expiresAt) })}</p>
    <div class="mt-3 flex flex-wrap items-center gap-2" data-testid="pending-change-actions">
      {#if ceremonyUrl}
        <a href={ceremonyUrl} target="_blank" rel="noopener noreferrer" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">{t('secrets.request.open-link', 'Open the signing page')}<span class="sr-only"> {t('secrets.request.new-tab', '(opens in a new tab)')}</span><span aria-hidden="true"> ↗</span></a>
      {:else}
        <p class="text-xs text-amber-800 dark:text-amber-300">{t('secrets.request.unlinked', "This change is staged on the server and still needs your signature, but this portal cannot offer its signing page. Open the request with the Hadron CLI or on the server's own page. Nothing has been changed yet.")}</p>
      {/if}
      <form method="POST" {action} use:enhance={() => async ({ update }) => { await update({ invalidateAll: false }); await readAgain().catch(() => { rereadFailed = true; });
          // The page re-renders after update(); read the notice's connection only once it has.
          await tick();
          // A withdrawn request is dropped from the page, so focus lands on the page title then.
          const target = root?.isConnected ? root : document.querySelector<HTMLElement>(focusFallback);
          target?.setAttribute('tabindex', '-1');
          target?.focus(); }}>
        <input type="hidden" name="requestId" value={requestId} />
        <button type="submit" disabled={impersonating} class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">{t('secrets.request.withdraw', 'Withdraw')}</button>
      </form>
    </div>
  {/if}
</div>
