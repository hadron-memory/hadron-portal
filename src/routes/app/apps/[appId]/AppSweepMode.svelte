<script lang="ts">
  // portal#2194 (hadron-server#4242): the user wants to choose whether the host
  // sweep leaves this App's workers alone, only reports on them, or also repairs
  // them. Applying starts and stops agent processes, so it is confirmed next to
  // the action. `mode` null means the server did not say: nothing renders. Only
  // an App manager gets the controls; the server stays the authority and its
  // refusal is shown as it comes back.
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t } from '$lib/i18n/t';

  type Mode = 'OFF' | 'OBSERVE' | 'APPLY';
  let { mode, canManage }: { mode: Mode | null; canManage: boolean } = $props();

  let draft = $state<Mode | null>(null);
  const chosen = $derived(draft ?? mode);
  const changed = $derived(mode !== null && chosen !== mode);
  let confirming = $state(false);
  let saving = $state(false);
  let feedback = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let formEl = $state<HTMLFormElement | null>(null);

  const failed = t('app.sweep-mode.error.failed', 'Not saved. Try again.');
  const submit: SubmitFunction = () => {
    saving = true;
    feedback = null;
    return async ({ result }) => {
      saving = false;
      confirming = false;
      if (result.type === 'success') {
        feedback = { kind: 'ok', text: t('app.sweep-mode.saved', 'Saved.') };
        draft = null;
        await invalidateAll();
      } else if (result.type === 'failure') {
        feedback = { kind: 'error', text: String((result.data as { sweepModeError?: string } | undefined)?.sweepModeError ?? failed) };
      } else {
        feedback = { kind: 'error', text: failed };
      }
    };
  };
  const options: Array<{ value: Mode; label: string; help: string }> = [
    { value: 'OFF', label: t('app.sweep-mode.off.label', 'Off'), help: t('app.sweep-mode.off.help', 'The sweep acts on no worker.') },
    { value: 'OBSERVE', label: t('app.sweep-mode.observe.label', 'Observe'), help: t('app.sweep-mode.observe.help', 'The sweep compares what should run with what it sees and reports. It repairs nothing.') },
    { value: 'APPLY', label: t('app.sweep-mode.apply.label', 'Apply'), help: t('app.sweep-mode.apply.help', 'The sweep also repairs what it can.') },
  ];
  function pick(v: Mode) { draft = v; confirming = false; feedback = null; }
  function save() {
    if (chosen === 'APPLY') confirming = true;
    else formEl?.requestSubmit();
  }
</script>

{#if mode}
  <section class="max-w-lg" aria-labelledby="sweepModeHeading">
    <h2 id="sweepModeHeading" class="mb-2 font-semibold text-zinc-900 dark:text-white">{t('app.sweep-mode.heading', 'Sweep mode')}</h2>
    <form bind:this={formEl} method="POST" action="?/setSweepMode" use:enhance={submit} novalidate
      class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {#if canManage}
        <fieldset class="space-y-2">
          <legend class="sr-only">{t('app.sweep-mode.heading', 'Sweep mode')}</legend>
          {#each options as o (o.value)}
            <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="radio" name="mode" value={o.value} checked={chosen === o.value} onchange={() => pick(o.value)} class="mt-0.5" />
              <span>{o.label}<span class="block text-zinc-500">{o.help}</span></span>
            </label>
          {/each}
        </fieldset>
        {#if confirming}
          <div role="alert" class="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <p>{t('app.sweep-mode.apply.confirm', 'Apply starts and stops agent processes in this App. Workers marked leave alone are not touched.')}</p>
            <div class="flex items-center gap-2">
              <button type="submit" disabled={saving} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                {saving ? t('app.sweep-mode.saving', 'Saving…') : t('app.sweep-mode.apply.go', 'Apply')}
              </button>
              <button type="button" onclick={() => { confirming = false; }} class="text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-300">{t('app.sweep-mode.cancel', 'Cancel')}</button>
            </div>
          </div>
        {/if}
        {#if feedback?.kind === 'error'}
          <p role="alert" class="text-sm text-red-600 dark:text-red-400">{feedback.text}</p>
        {:else if feedback?.kind === 'ok'}
          <p role="status" class="text-sm text-emerald-600 dark:text-emerald-400">{feedback.text}</p>
        {/if}
        {#if !confirming}
          <button type="button" onclick={save} disabled={saving || !changed} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {saving ? t('app.sweep-mode.saving', 'Saving…') : t('app.sweep-mode.save', 'Save')}
          </button>
        {/if}
      {:else}
        <p class="text-sm text-zinc-700 dark:text-zinc-300">{options.find((o) => o.value === mode)?.label}</p>
        <p class="text-sm text-zinc-500">{options.find((o) => o.value === mode)?.help}</p>
      {/if}
    </form>
  </section>
{/if}
