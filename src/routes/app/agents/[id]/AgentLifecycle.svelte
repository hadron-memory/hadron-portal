<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // portal#2194 (hadron-server#4242): the user wants to choose whether this
  // agent's workers keep running or run only while they have a task. Only
  // lifecycle is sent (omitted means unchanged on the server). The server's
  // updateAgent gate decides who may; this shows its refusal as it comes back.
  import { enhance } from '$app/forms';
  import { beginWrite, clearRecovery, failWrite, isUncertainResult, recoveryOf, settleWriteOutcome } from '$lib/write-recovery.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t } from '$lib/i18n/t';

  type Lifecycle = 'LONG_LIVED' | 'SHORT_LIVED';
  let { lifecycle, ownerId }: { lifecycle: Lifecycle; ownerId: string } = $props();

  // The pick is kept only while it differs from the saved value, so a reused
  // component follows the loader again after a save or a navigation.
  let draft = $state<Lifecycle | null>(null);
  // See AppSweepMode: a committed write with an unconfirmed reload is kept per Agent, outside this
  // control's lifetime, until the loader shows the value the server confirmed.
  const recovery = $derived(recoveryOf(`lifecycle:${ownerId}`));
  const locked = $derived(recovery !== undefined);
  const chosen = $derived((recovery?.value as Lifecycle | undefined) ?? draft ?? lifecycle);
  const changed = $derived(chosen !== lifecycle);
  let saving = $state(false);
  let feedback = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // The page reuses this component for another Agent: what is in flight belongs to the one left.
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
    saving = false;
    feedback = null;
  });
  $effect(() => {
    if (recovery?.phase === 'stale' && lifecycle === recovery.value) clearRecovery(`lifecycle:${ownerId}`);
  });

  const failed = t('agent.lifecycle.error.failed', 'Not saved. Try again.');
  const submit: SubmitFunction = ({ formData }) => {
    const mine = gen;
    const owner = ownerId;
    const written = String(formData.get('lifecycle') ?? '');
    const token = beginWrite(`lifecycle:${owner}`, written);
    saving = true;
    feedback = null;
    return async ({ result }) => {
      // A refusal or a GraphQL error response did not commit. No answer at all (`error`, or the action
      // saying it could not reach the server) leaves the outcome unknown: keep the lock and check.
      const uncertain = isUncertainResult(result);
      if (result.type === 'success' || uncertain) {
        if (mine === gen) {
          saving = false;
          draft = null;
          feedback = uncertain ? null : { kind: 'ok', text: t('agent.lifecycle.saved', 'Saved.') };
        }
        await settleWriteOutcome(`lifecycle:${owner}`, token, written, mine === gen, () => (ownerId === owner ? lifecycle : undefined), uncertain);
        return;
      }
      failWrite(`lifecycle:${owner}`, token);
      if (mine !== gen) return;
      saving = false;
      if (result.type === 'failure') {
        feedback = { kind: 'error', text: String((result.data as { lifecycleError?: string } | undefined)?.lifecycleError ?? failed) };
      } else {
        feedback = { kind: 'error', text: failed };
      }
    };
  };
</script>

<section class="max-w-lg" aria-labelledby="lifecycleHeading">
  <h2 id="lifecycleHeading" class="mb-2 font-semibold text-zinc-900 dark:text-white">{t('agent.lifecycle.heading', 'Worker lifecycle')}</h2>
  <form method="POST" action="?/updateLifecycle" use:enhance={submit} novalidate
    class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <fieldset class="space-y-2" disabled={saving || locked}>
      <legend class="sr-only">{t('agent.lifecycle.heading', 'Worker lifecycle')}</legend>
      <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="radio" name="lifecycle" value="LONG_LIVED" checked={chosen === 'LONG_LIVED'} onchange={() => { draft = 'LONG_LIVED'; feedback = null; }} class="mt-0.5" />
        <span>
          {t('agent.lifecycle.long.label', 'Always running')}
          <span class="block text-zinc-500">{t('agent.lifecycle.long.help', 'Its workers’ processes keep running.')}</span>
        </span>
      </label>
      <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="radio" name="lifecycle" value="SHORT_LIVED" checked={chosen === 'SHORT_LIVED'} onchange={() => { draft = 'SHORT_LIVED'; feedback = null; }} class="mt-0.5" />
        <span>
          {t('agent.lifecycle.short.label', 'Only while it has a task')}
          <span class="block text-zinc-500">{t('agent.lifecycle.short.help', 'Its workers’ processes run only while they hold a pending or started task.')}</span>
        </span>
      </label>
    </fieldset>
    {#if feedback?.kind === 'error'}
      <p role="alert" class="text-sm text-red-600 dark:text-red-400">{feedback.text}</p>
    {/if}
    <LiveRegion>
      {#if feedback?.kind === 'ok'}
        <p class="text-sm text-emerald-600 dark:text-emerald-400">{feedback.text}</p>
      {/if}
    </LiveRegion>
    <LiveRegion>
      {#if recovery?.uncertain && recovery.phase !== 'stale'}
        <p class="text-sm text-zinc-500">{t('agent.lifecycle.unconfirmed', 'Couldn’t confirm the save; checking…')}</p>
      {/if}
    </LiveRegion>
    {#if recovery?.phase === 'stale'}
      <div role="alert" class="space-y-2 text-sm text-red-600 dark:text-red-400">
        <p>{recovery.uncertain
          ? t('agent.lifecycle.stale-unconfirmed', 'Couldn’t confirm the save, and this page could not reload. Reload the page before relying on what it shows.')
          : t('agent.lifecycle.stale', 'Saved, but this page could not reload and may be out of date. Reload the page before relying on what it shows.')}</p>
        <button type="button" onclick={() => location.reload()} class="rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">{t('agent.lifecycle.reload', 'Reload')}</button>
      </div>
    {/if}
    <button type="submit" disabled={saving || locked || !changed} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
      {saving ? t('agent.lifecycle.saving', 'Saving…') : t('agent.lifecycle.save', 'Save')}
    </button>
  </form>
</section>
