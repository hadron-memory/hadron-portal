<!--
  #992 — "Approve all nodes" (hadron-server#1591 approveMemoryNodes). Confirm,
  then the result: counts and any skipped placeholders by URN.

  Bound to the memory it was opened for. The memory layout is reused when the
  reader moves from memory A to B, so a change of memory closes the dialog and
  drops anything in flight, and a result keeps the URN it was for: a late
  answer for A never renders under B, and A's placeholder locs are never
  composed into B's URNs (Gene on #994).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { approveAllFeedbackWarning, approveAllSummary, approveAllUnconfirmedText, type ApproveMemoryNodesResult } from '$lib/memory-approval';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import SkippedPlaceholdersTable from './SkippedPlaceholdersTable.svelte';
  import OpenFeedbackWarning from './OpenFeedbackWarning.svelte';

  let {
    memory,
    open = $bindable(false),
    onapproved,
  }: {
    memory: { id: string; urn: string };
    open?: boolean;
    /** After a confirmed approval, so the page can refresh what it shows. */
    onapproved?: () => void;
  } = $props();

  let approving = $state(false);
  let error = $state<string | null>(null);
  let done = $state<{ memoryUrn: string; result: ApproveMemoryNodesResult } | null>(null);
  let seq = 0;

  // Each opening starts from the confirm step.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      if (!approving) {
        error = null;
        done = null;
      }
    });
  });

  // A different memory: close, and drop anything in flight for the old one.
  let boundTo = untrack(() => memory.id);
  $effect(() => {
    const id = memory.id;
    if (id === boundTo) return;
    boundTo = id;
    seq++;
    open = false;
    approving = false;
    error = null;
    done = null;
  });

  async function submit() {
    if (approving) return;
    const target = { id: memory.id, urn: memory.urn };
    const mine = ++seq;
    approving = true;
    error = null;
    try {
      const res = await fetch(`/app/memories/${target.id}/approve-all`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (mine !== seq) return;
      if (!res.ok || !d.result) {
        // Typed refusals carry fixed copy; anything else is an unknown outcome.
        error = typeof d.error === 'string' && res.status !== 401 ? d.error : approveAllUnconfirmedText();
        return;
      }
      done = { memoryUrn: target.urn, result: d.result };
      onapproved?.();
    } catch {
      // No answer at all: the request may still have committed.
      if (mine === seq) error = approveAllUnconfirmedText();
    } finally {
      if (mine === seq) approving = false;
    }
  }

  function placeholderUrn(memoryUrn: string, loc: string): string | null {
    try {
      return composeNodeUrn(memoryUrn, loc);
    } catch {
      return null;
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-40">
    <button type="button" class="absolute inset-0 cursor-default bg-black/20" aria-label={t('memory-actions.approve-all.close', 'Close approve all dialog')} onclick={() => (open = false)}></button>
    <div role="dialog" aria-labelledby="approve-all-heading" data-testid="approve-all-dialog" class="absolute right-4 top-24 w-[36rem] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <h3 id="approve-all-heading" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('memory-actions.approve-all.heading', 'Approve all nodes')}</h3>
      {#if done}
        {@const r = done}
        <p role="status" data-testid="approve-all-result" class="text-sm text-zinc-700 dark:text-zinc-300">{approveAllSummary(r.result)}</p>
        {#if approveAllFeedbackWarning(r.result)}
          <OpenFeedbackWarning testid="approve-all-open-feedback" listKey="memories:approve-all:open-feedback" items={r.result.openFeedback} text={approveAllFeedbackWarning(r.result) ?? ''} />
        {/if}
        {#if r.result.skippedPlaceholders.length > 0}
          <div class="mt-2">
            <SkippedPlaceholdersTable rows={r.result.skippedPlaceholders.map((loc) => ({ loc, urn: placeholderUrn(r.memoryUrn, loc) }))} />
          </div>
        {/if}
        <div class="mt-3">
          <button type="button" onclick={() => (open = false)} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('memory-actions.approve-all.done', 'Done')}</button>
        </div>
      {:else}
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          {t('memory-actions.approve-all.explain', 'This approves the current revision of every node in this memory that isn’t minted or approved yet, and records you as the approver of each. Reserved placeholders are skipped. Read what you approve: an approval says you reviewed this text.')}
        </p>
        <!-- portal#1014 (Jane on #1025, P3): the server reports open feedback only with
             the result, so before approving the dialog points at where it already shows. -->
        <p data-testid="approve-all-feedback-hint" class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {t('memory-actions.approve-all.feedback-hint', 'Nodes with open discussions are marked in the node list. Read those discussions first: approving doesn’t resolve them.')}
        </p>
        {#if error}
          <p role="alert" data-testid="approve-all-error" class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        {/if}
        <div class="mt-3 flex items-center gap-2">
          <button type="button" data-testid="approve-all-submit" onclick={submit} disabled={approving}
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >{approving ? t('memory-actions.approve-all.approving', 'Approving…') : t('memory-actions.approve-all.submit', 'Approve all')}</button>
          <button type="button" onclick={() => (open = false)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('memory-actions.approve-all.cancel', 'Cancel')}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}
