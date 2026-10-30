<!--
  portal#1141 slice A — the App's delivery settings (hadron-server S9). The one
  write on the Tickers page; the ticker settings beside it stay read-only.

  - No client-side rights check: every participant whose read succeeded is offered
    the form and the server's refusal answers anyone who may not (a manage audit
    under-reports owner-role members, Rodolfo's §10 P2 on #1152). A support
    session sees the values only.
  - A save sends only the fields the reader changed (see buildDeliveryPatch). The
    standby switch is never offered or sent: it is slice B, after S7. Its stored
    and effective values are shown exactly as the server returns them, and
    nothing here says standby works.
  - Nothing is optimistic. A refusal keeps what was typed and shows the server's
    sentence verbatim; a success reloads and shows the STORED values.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import type { AppDeliverySettings, TickerRead } from '$lib/tickers/types';

  let {
    appId,
    settings,
    impersonating = null,
  }: {
    appId: string;
    settings: TickerRead<AppDeliverySettings>;
    impersonating?: string | null;
  } = $props();

  const FIELDS = ['batchWindowSeconds', 'busyDelaySeconds', 'stuckWindowSeconds'] as const;
  type Field = (typeof FIELDS)[number];

  // What the reader typed, per field. A field not in here shows the stored value.
  let typed = $state<Record<string, string>>({});
  let submitting = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let status = $state<string | null>(null);
  let statusLine = $state<HTMLElement | null>(null);

  // Reused across routes: a different App starts from its own stored values.
  // `generation` fences a result that lands late (Cedar's P2 on #1152): each
  // submit takes a number, a route change takes the next one, and a result
  // that finds the counter moved on touches nothing, not even after the
  // reload it started. Plain, not $state: it is only ever compared.
  let generation = 0;
  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    if (seededFor !== appId) {
      generation++;
      typed = {};
      refusal = null;
      status = null;
      submitting = false;
      seededFor = appId;
    }
  });

  const editable = $derived(!impersonating);

  function labelFor(f: Field): string {
    switch (f) {
      case 'batchWindowSeconds':
        return t('app.tickers.delivery.batch', 'Batching window (seconds)');
      case 'busyDelaySeconds':
        return t('app.tickers.delivery.busy', 'Busy delay (seconds)');
      case 'stuckWindowSeconds':
        return t('app.tickers.delivery.stuck', 'Stuck window (seconds)');
    }
  }

  function helpFor(f: Field): string {
    switch (f) {
      case 'batchWindowSeconds':
        return t(
          'app.tickers.delivery.batch.help',
          'This is the same setting as the fastest ticker. Changing it changes how often tickers can run, and the stuck window must stay longer than the busy delay plus this window.',
        );
      case 'busyDelaySeconds':
        return t('app.tickers.delivery.busy.help', 'Whole seconds. The server currently accepts 1 to 86,400.');
      case 'stuckWindowSeconds':
        return t(
          'app.tickers.delivery.stuck.help',
          'Whole seconds. The server currently accepts 1 to 604,800, and requires it to be longer than the busy delay plus the batching window.',
        );
    }
  }

  function standbyText(s: AppDeliverySettings): string {
    if (s.standbyEnabled && !s.standbyEffective) {
      return t('app.tickers.delivery.standby.pending', 'Standby: configured, not in effect yet.');
    }
    return s.standbyEnabled ? t('app.tickers.delivery.standby.on', 'Standby: on') : t('app.tickers.delivery.standby.off', 'Standby: off');
  }

  function submitter() {
    return () => {
      const mine = ++generation;
      submitting = true;
      status = null;
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          await invalidateAll();
          if (mine !== generation) return;
          typed = {};
          refusal = null;
          status = t('app.tickers.delivery.saved', 'Saved. These are the stored values.');
          await tick();
          statusLine?.focus();
          return;
        }
        refusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
        if (refusal.kind === 'invalid' && refusal.field !== 'form') {
          await tick();
          document.getElementById(`delivery-${refusal.field}`)?.focus();
        }
      };
    };
  }
</script>

<section aria-labelledby="delivery-settings-heading" class="space-y-2" data-testid="delivery-settings">
  <h2 id="delivery-settings-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tickers.delivery.heading', 'Delivery')}</h2>

  {#if settings.kind === 'failed'}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {t('app.tickers.delivery.failed', 'Couldn’t load this App’s delivery settings.')}
    </div>
  {:else if settings.kind === 'ok'}
    {@const s = settings.value}
    {#if editable}
      <form
        method="POST"
        action="?/delivery"
        use:enhance={submitter()}
        class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {#each FIELDS as f (f)}
          <div class="min-w-0">
            <label for="delivery-{f}" class="font-medium text-zinc-900 dark:text-white">{labelFor(f)}</label>
            <input type="hidden" name="{f}Was" value={String(s[f])} />
            <input
              id="delivery-{f}"
              name={f}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={typed[f] ?? String(s[f])}
              oninput={(e) => (typed[f] = e.currentTarget.value)}
              aria-describedby="delivery-{f}-help"
              aria-invalid={refusal?.kind === 'invalid' && refusal.field === f ? 'true' : undefined}
              class="mt-1 block w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
            <p id="delivery-{f}-help" class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{helpFor(f)}</p>
          </div>
        {/each}
        <p class="text-zinc-600 dark:text-zinc-400" data-testid="delivery-standby">{standbyText(s)}</p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tickers.settings.who', 'Only whoever manages the App can change these settings.')}</p>
        {#if refusal}<WriteRefusalAlert {refusal} />{/if}
        {#if status}
          <p bind:this={statusLine} tabindex="-1" role="status" aria-live="polite" class="text-sm font-medium text-green-700 dark:text-green-300">{status}</p>
        {/if}
        <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {submitting ? t('app.tickers.delivery.saving', 'Saving…') : t('app.tickers.delivery.save', 'Save delivery settings')}
        </button>
      </form>
    {:else}
      <dl class="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        {#each FIELDS as f (f)}
          <div class="min-w-0">
            <dt class="font-medium text-zinc-900 dark:text-white">{labelFor(f)}</dt>
            <dd class="text-zinc-600 dark:text-zinc-400">{s[f]}</dd>
          </div>
        {/each}
        <div class="min-w-0 sm:col-span-2" data-testid="delivery-standby">
          <dd class="text-zinc-600 dark:text-zinc-400">{standbyText(s)}</dd>
        </div>
      </dl>
      <p class="text-xs text-zinc-500 dark:text-zinc-400">
        {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating ?? '—' })}
      </p>
    {/if}
  {/if}
</section>
