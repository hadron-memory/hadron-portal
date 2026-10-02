<!--
  #992 — whether the revision on screen is approved (hadron-server#1591).
  "Changed since approval" is attention, not an error: the node was edited
  after an approval, which is ordinary, and the old approval still stands for
  the revision it named.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { approvalText, approverLabel, shortHash, type ApprovalView } from '$lib/node-approval';
  import Urn from './Urn.svelte';

  let { view }: { view: ApprovalView } = $props();

  const toneClass = $derived(
    view.tone === 'approved'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
      : view.tone === 'attention'
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  );
  const approver = $derived(approverLabel(view.approval));
  const approverUrn = $derived(view.approval?.approvedBy?.urn?.trim() || null);
</script>

<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
  <span data-testid="approval-state" data-state={view.state} class="rounded-full px-2 py-0.5 font-medium {toneClass}">
    {approvalText(view)}
  </span>
  {#if view.approval}
    <span data-testid="approval-detail" class="text-zinc-500 dark:text-zinc-400">
      {#if approver}
        {t('node.approval.detail-by', 'Revision {rev} approved by {who} on {when}', {
          rev: view.approval.revision,
          who: approver,
          when: new Date(view.approval.approvedAt).toLocaleString(),
        })}
      {:else}
        {t('node.approval.detail', 'Revision {rev} approved on {when}', {
          rev: view.approval.revision,
          when: new Date(view.approval.approvedAt).toLocaleString(),
        })}
      {/if}
      {#if approverUrn}
        <Urn value={approverUrn} size={9} />
      {/if}
      <span class="font-mono" title={view.approval.hash}>· {shortHash(view.approval.hash)}</span>
    </span>
  {/if}
</span>
