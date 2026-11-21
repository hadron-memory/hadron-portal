<script lang="ts">
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n/t';
  import { isOpenState, requestStateText } from '$lib/secrets/staged';
  import { fmtRunTime } from '$lib/flow/runs';

  /**
   * portal#2380 — a change that waits for the person's passkey signature. The link goes to the
   * server's own page; the portal never completes the ceremony. The state is a read made when
   * the page loaded, so it refreshes on revisit.
   */
  let { requestId, ceremonyUrl, state, operation, expiresAt, impersonating = false }: {
    requestId: string; ceremonyUrl: string; state: string; operation: string; expiresAt: string; impersonating?: boolean;
  } = $props();
  const open = $derived(isOpenState(state));
  const opText = $derived.by(() => {
    switch (operation.toUpperCase()) {
      case 'STORE': return t('secrets.request.op.store', 'a new value');
      case 'DELETE': return t('secrets.request.op.delete', 'deleting this secret');
      case 'CREATE': return t('secrets.request.op.create', 'creating this secret');
      case 'SET_PROTECTED': return t('secrets.request.op.protect', 'turning protection on');
      case 'CLEAR_PROTECTED': return t('secrets.request.op.unprotect', 'turning protection off');
      default: return operation;
    }
  });
</script>

<div class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950" data-testid="pending-change">
  <p class="font-medium text-amber-900 dark:text-amber-100">{requestStateText(state)}</p>
  <p class="mt-1 text-amber-900 dark:text-amber-200">
    {#if open}
      {t('secrets.request.waiting', 'This change waits for a passkey signature: {op}. Nothing has been saved yet.', { op: opText })}
    {:else}
      {t('secrets.request.ended', 'This request was for {op}.', { op: opText })}
    {/if}
  </p>
  {#if open}
    <p class="mt-1 text-xs text-amber-800 dark:text-amber-300">{t('secrets.request.expires', 'Expires {time}', { time: fmtRunTime(expiresAt) })}</p>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <a href={ceremonyUrl} target="_blank" rel="noopener noreferrer" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">{t('secrets.request.open-link', 'Open the signing page')}</a>
      <form method="POST" action="?/withdraw" use:enhance>
        <input type="hidden" name="requestId" value={requestId} />
        <button type="submit" disabled={impersonating} class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">{t('secrets.request.withdraw', 'Withdraw')}</button>
      </form>
    </div>
  {/if}
</div>
