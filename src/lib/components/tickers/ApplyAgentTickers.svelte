<!--
  portal#1462 — the Wake-ups tab's manager action: apply the Agent's ticker
  templates to this worker (hadron-server#2860;
  hrn:node:hadronmemory.com:hadron-dev-team-victor:drafts:080:080-34).

  - Offered unless the page KNOWS the viewer does not manage the App (an
    explicit `canManage === false`), as the boot-prompt pointer form is. It is
    a presentation hint: the server decides who may, and a refusal is shown.
  - One POST, no fields: the route names the worker. Never automatic, never
    retried here.
  - The receipt prints the EFFECTIVE cadence only. The result does not carry the
    template's declared one, so "the App's floor" appears on equality with the
    floor and nothing ever says "raised" (Xavier's gate delta 2).
  - A refusal says "nothing was created" only for the two the server refuses
    whole; anything else is outcome-unknown, with a hint to refresh.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import Urn from '$lib/components/Urn.svelte';
  import { floorLabel, type ApplyResult } from '$lib/tickers/apply';
  import { cadenceText } from '$lib/tickers/format';
  import { t } from '$lib/i18n/t';

  let {
    canManage,
    action,
    workerKey,
    result = null,
    floorSeconds = null,
  }: {
    canManage: boolean | null;
    action: string;
    /** The worker this panel is showing; a result for another worker is never shown. */
    workerKey: string;
    result?: ApplyResult | null;
    floorSeconds?: number | null;
  } = $props();

  // A result written for another worker (the page is reused across /workers/A → B) is not this one's.
  const shown = $derived(result && result.key === workerKey ? result : null);
  let submitting = $state(false);

  const submit = () => {
    submitting = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      try {
        await update({ reset: false });
      } finally {
        submitting = false;
      }
    };
  };
</script>

{#if canManage !== false}
  <section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" data-testid="apply-tickers" aria-labelledby="apply-tickers-title">
    <h3 id="apply-tickers-title" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('worker.apply.title', 'Agent tickers')}</h3>
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {t('worker.apply.help', 'Adds the tickers this worker’s Agent declares that it doesn’t have yet. Existing tickers and subscriptions are left as they are.')}
    </p>
    <form method="POST" {action} use:enhance={submit}>
      <button
        type="submit"
        disabled={submitting}
        aria-describedby={shown ? 'apply-tickers-result' : undefined}
        class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >{t('worker.apply.button', 'Apply the Agent’s tickers')}</button>
    </form>

    {#if shown && 'refusal' in shown}
      <div id="apply-tickers-result" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="apply-refusal">
        <p>{shown.refusal.message}</p>
        {#if shown.refusal.code}<code class="font-mono opacity-80">{shown.refusal.code}</code>{/if}
      </div>
    {:else if shown}
      <div id="apply-tickers-result" role="status" class="space-y-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200" data-testid="apply-receipt">
        {#if shown.created.length === 0}
          <p>{t('worker.apply.none', 'Nothing to create: this worker already has every ticker its Agent declares.')}</p>
        {:else}
          <p class="font-semibold">{t('worker.apply.created', 'Created {n} ticker(s):', { n: shown.created.length })}</p>
          <ul class="space-y-1.5">
            {#each shown.created as c (c.tickerId)}
              {@const label = floorLabel(c.effectiveCadenceSeconds, floorSeconds)}
              <li class="min-w-0">
                <span class="font-medium break-words">{c.tickerName}</span>
                <span class="text-green-800 dark:text-green-300">
                  {t('worker.apply.from', 'from {template}', { template: c.templateName })} ·
                  {t('worker.apply.every', 'every {every}', { every: cadenceText(c.effectiveCadenceSeconds) })}{#if label}&nbsp;({label}){/if}
                </span>
                {#if c.tickerUrn}<div class="mt-0.5"><Urn value={c.tickerUrn} size={9} compact linked label={t('app.tickers.urn-label', 'ticker')} /></div>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if shown.alreadyPresent.length > 0}
          <div>
            <p class="font-semibold">{t('worker.apply.already', 'Already had:')}</p>
            <ul class="list-inside list-disc">
              {#each shown.alreadyPresent as a (a.id)}<li class="break-words">{a.name}</li>{/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </section>
{/if}
