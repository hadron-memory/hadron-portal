<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // portal#2194 (hadron-server#4242): the user wants to keep the host sweep away
  // from this worker, and to see who did so and why. `marker` null means the
  // caller may see only the worker's profile: nothing is shown, which is not the
  // same as "not marked". Only an App manager gets the buttons; the server stays
  // the authority and its refusal is shown as it comes back.
  import { enhance } from '$app/forms';
  import { beginWrite, clearRecovery, failWrite, isUncertainResult, recoveryOf, settleWriteOutcome } from '$lib/write-recovery.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t } from '$lib/i18n/t';

  type Marker = { on: boolean; reason: string | null; by: string | null; at: string | null };
  let { marker, canManage, retired = false, ownerId }: { marker: Marker | null; canManage: boolean; retired?: boolean; ownerId: string } = $props();

  // The full value a marker carries, as the write sends it: on/off plus the reason. A write is
  // confirmed only when the loader shows all of it (a matching on-state with another reason is an
  // older marker, not this write).
  const markerKey = (on: boolean, reason: string | null | undefined): string => `${on}|${on ? (reason ?? '').trim() : ''}`;
  let marking = $state(false);
  let saving = $state(false);
  let feedback = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // A committed write with an unconfirmed reload is kept per worker, outside this control's lifetime
  // (the page remounts it on a tab switch): the old marker must not come back as current.
  const recovery = $derived(recoveryOf(`leave-alone:${ownerId}`));
  const locked = $derived(recovery !== undefined);
  $effect(() => {
    if (recovery?.phase === 'stale' && marker && markerKey(marker.on, marker.reason) === recovery.value) clearRecovery(`leave-alone:${ownerId}`);
  });
  const failed = t('worker.leave-alone.error.failed', 'Not saved. Try again.');

  const submit: SubmitFunction = ({ formData }) => {
    const owner = ownerId;
    const written = markerKey(String(formData.get('leaveAlone') ?? '') === 'true', String(formData.get('reason') ?? ''));
    const token = beginWrite(`leave-alone:${owner}`, written);
    saving = true;
    feedback = null;
    return async ({ result }) => {
      saving = false;
      // A refusal or a GraphQL error response did not commit. No answer at all leaves the outcome
      // unknown: keep the lock and check, never say "Not saved".
      const uncertain = isUncertainResult(result);
      if (result.type === 'success' || uncertain) {
        feedback = uncertain ? null : { kind: 'ok', text: t('worker.leave-alone.saved', 'Saved.') };
        marking = false;
        await settleWriteOutcome(`leave-alone:${owner}`, token, written, true, () => (ownerId === owner && marker ? markerKey(marker.on, marker.reason) : undefined), uncertain);
      } else if (result.type === 'failure') {
        failWrite(`leave-alone:${owner}`, token);
        feedback = { kind: 'error', text: String((result.data as { leaveAloneError?: string } | undefined)?.leaveAloneError ?? failed) };
      } else {
        failWrite(`leave-alone:${owner}`, token);
        feedback = { kind: 'error', text: failed };
      }
    };
  };
  function when(s: string | null): string {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
  }
</script>

{#if marker}
  <section class="max-w-lg rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="worker-leave-alone-title">
    <h2 id="worker-leave-alone-title" class="mb-2 font-semibold text-zinc-900 dark:text-white">{t('worker.leave-alone.heading', 'Leave alone')}</h2>
    {#if recovery && recovery.phase !== 'inflight'}
      <p class="text-sm text-zinc-500">{t('worker.leave-alone.unknown', 'The current marker is unknown until this page reloads.')}</p>
    {:else if marker.on}
      <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('worker.leave-alone.on', 'The host sweep leaves this worker alone: it reports it and never starts, stops or repairs it.')}</p>
      <dl class="mt-2 space-y-1 text-sm">
        {#if marker.reason}
          <div><dt class="inline text-zinc-500">{t('worker.leave-alone.reason', 'Reason')}:</dt> <dd class="inline text-zinc-900 dark:text-white">{marker.reason}</dd></div>
        {/if}
        {#if marker.by}
          <div><dt class="inline text-zinc-500">{t('worker.leave-alone.by', 'Set by')}:</dt> <dd class="inline text-zinc-900 dark:text-white">{marker.by}</dd></div>
        {/if}
        {#if marker.at}
          <div><dt class="inline text-zinc-500">{t('worker.leave-alone.at', 'Set')}:</dt> <dd class="inline text-zinc-900 dark:text-white">{when(marker.at)}</dd></div>
        {/if}
      </dl>
    {:else}
      <p class="text-sm text-zinc-500">{t('worker.leave-alone.off', 'Not marked. The host sweep treats this worker like any other.')}</p>
    {/if}

    {#if canManage && !retired}
      <form method="POST" action="?/setLeaveAlone" use:enhance={submit} novalidate class="mt-3 space-y-3">
        {#if marker.on}
          <input type="hidden" name="leaveAlone" value="false" />
          <button type="submit" disabled={saving || locked} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            {saving ? t('worker.leave-alone.saving', 'Saving…') : t('worker.leave-alone.clear', 'Clear')}
          </button>
        {:else if marking}
          <input type="hidden" name="leaveAlone" value="true" />
          <label class="block text-sm text-zinc-700 dark:text-zinc-300" for="leave-alone-reason">{t('worker.leave-alone.reason-label', 'Reason')}</label>
          <input id="leave-alone-reason" name="reason" type="text" maxlength="500" autocomplete="off"
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          <div class="flex items-center gap-2">
            <button type="submit" disabled={saving || locked} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
              {saving ? t('worker.leave-alone.saving', 'Saving…') : t('worker.leave-alone.save', 'Save')}
            </button>
            <button type="button" onclick={() => { marking = false; }} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('worker.leave-alone.cancel', 'Cancel')}</button>
          </div>
        {:else}
          <button type="button" disabled={locked} onclick={() => { marking = true; feedback = null; }} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            {t('worker.leave-alone.mark', 'Leave alone…')}
          </button>
        {/if}
        {#if recovery?.phase === 'stale'}
          <div role="alert" class="space-y-2 text-sm text-red-600 dark:text-red-400">
            <p>{recovery.uncertain
              ? t('worker.leave-alone.stale-unconfirmed', 'Couldn’t confirm the save, and this page could not reload. Reload the page before relying on what it shows.')
              : t('worker.leave-alone.stale', 'Saved, but this page could not reload and may be out of date. Reload the page before relying on what it shows.')}</p>
            <button type="button" onclick={() => location.reload()} class="rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">{t('worker.leave-alone.reload', 'Reload')}</button>
          </div>
        {/if}
        {#if feedback?.kind === 'error'}
          <p role="alert" class="text-sm text-red-600 dark:text-red-400">{feedback.text}</p>
        {/if}
      </form>
      <!-- Outside the space-y form: an idle region is the form's last child (every sibling after
           it is conditional), which would give the element before it a trailing margin (portal#2375 QA F1). -->
      <LiveRegion>
        {#if recovery?.uncertain && recovery.phase !== 'stale'}
          <p class="mt-3 text-sm text-zinc-500">{t('worker.leave-alone.unconfirmed', 'Couldn’t confirm the save; checking…')}</p>
        {/if}
      </LiveRegion>
      <LiveRegion>
        {#if feedback?.kind === 'ok'}
          <p class="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{feedback.text}</p>
        {/if}
      </LiveRegion>
    {/if}
  </section>
{/if}
