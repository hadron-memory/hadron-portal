<script lang="ts">
  // portal#2194 (hadron-server#4242): the user wants to choose whether the host
  // sweep leaves this App's workers alone, only reports on them, or also repairs
  // them. Applying starts and stops agent processes, so it is confirmed next to
  // the action. `mode` null means the server did not say: nothing renders. Only
  // an App manager gets the controls; the server stays the authority and its
  // refusal is shown as it comes back.
  import { enhance } from '$app/forms';
  import { beginWrite, clearRecovery, failWrite, recoveryOf, settleCommittedWrite } from '$lib/write-recovery.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t } from '$lib/i18n/t';

  type Mode = 'OFF' | 'OBSERVE' | 'APPLY';
  let { mode, canManage, ownerId }: { mode: Mode | null; canManage: boolean; ownerId: string } = $props();

  let draft = $state<Mode | null>(null);
  // A write the server committed whose reload is unconfirmed lives in a store keyed by this App,
  // not here: this control can be torn down (Settings tab) or pointed at another App and back
  // before the answer lands, and a local flag would forget the write the loader has not shown yet.
  const recovery = $derived(recoveryOf(`sweep-mode:${ownerId}`));
  const locked = $derived(recovery !== undefined);
  const chosen = $derived(recovery?.value ?? draft ?? mode);
  const changed = $derived(mode !== null && chosen !== mode);
  let confirming = $state(false);
  let saving = $state(false);
  let feedback = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let formEl = $state<HTMLFormElement | null>(null);
  // The page reuses this component when the person moves to another App: a draft, an open
  // confirmation or a result still in flight belongs to the one they left.
  let seenOwner: string | undefined;
  let seeded = false;
  let gen = 0;
  $effect.pre(() => {
    const id = ownerId;
    if (!seeded) { seeded = true; seenOwner = id; return; }
    if (id === seenOwner) return;
    seenOwner = id;
    gen++;
    draft = null;
    confirming = false;
    saving = false;
    feedback = null;
  });
  // The loader caught up with what was written: the recovery has done its job.
  $effect(() => {
    if (recovery?.phase === 'stale' && mode === recovery.value) clearRecovery(`sweep-mode:${ownerId}`);
  });

  const failed = t('app.sweep-mode.error.failed', 'Not saved. Try again.');
  const submit: SubmitFunction = ({ formData }) => {
    const mine = gen;
    const owner = ownerId;
    const written = String(formData.get('mode') ?? '');
    const token = beginWrite(`sweep-mode:${owner}`, written);
    saving = true;
    feedback = null;
    return async ({ result }) => {
      if (result.type === 'success') {
        // Committed, whichever App is on screen now: it is recorded against the App it was sent to.
        if (mine === gen) {
          saving = false;
          confirming = false;
          draft = null;
          feedback = { kind: 'ok', text: t('app.sweep-mode.saved', 'Saved.') };
        }
        await settleCommittedWrite(`sweep-mode:${owner}`, token, written, mine === gen, () => (ownerId === owner ? (mode ?? undefined) : undefined));
        return;
      }
      failWrite(`sweep-mode:${owner}`, token);
      if (mine !== gen) return;
      saving = false;
      confirming = false;
      if (result.type === 'failure') {
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
        <fieldset class="space-y-2" disabled={saving || locked}>
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
              <button type="submit" disabled={saving || locked} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
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
        {#if recovery?.phase === 'stale'}
          <div role="alert" class="space-y-2 text-sm text-red-600 dark:text-red-400">
            <p>{t('app.sweep-mode.stale', 'Saved, but this page could not reload and may be out of date. Reload the page before relying on what it shows.')}</p>
            <button type="button" onclick={() => location.reload()} class="rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">{t('app.sweep-mode.reload', 'Reload')}</button>
          </div>
        {/if}
        {#if !confirming}
          <button type="button" onclick={save} disabled={saving || locked || !changed} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
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
