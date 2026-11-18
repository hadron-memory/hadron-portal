<!--
  #1129 — the server says whether the content on screen is still approved.
  The record names the revision at approval; metadata-only revisions can be newer.
  A content change is attention; a tamper finding belongs to verify, not this badge.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { approvalText, approverLabel, shortHash, type ApprovalView } from '$lib/node-approval';
  import Urn from './Urn.svelte';

  let { view, currentRevision }: { view: ApprovalView; currentRevision?: number | null } = $props();

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
        {t('node.approval.detail-by', 'Content approved at revision {rev} by {who} on {when}', {
          rev: view.approval.revision,
          who: approver,
          when: new Date(view.approval.approvedAt).toLocaleString(),
        })}
      {:else}
        {t('node.approval.detail', 'Content approved at revision {rev} on {when}', {
          rev: view.approval.revision,
          when: new Date(view.approval.approvedAt).toLocaleString(),
        })}
      {/if}
      {#if view.state === 'APPROVED' && currentRevision != null && currentRevision > view.approval.revision}
        <span data-testid="approval-current-revision">{t('node.approval.current-content', 'Current revision {rev}; its title, abstract and content are unchanged.', { rev: currentRevision })}</span>
      {/if}
      {#if approverUrn}
        <Urn value={approverUrn} size={9} />
      {/if}
      <span class="font-mono" title={view.approval.hash}>· {shortHash(view.approval.hash)}</span>
    </span>
  {/if}
</span>
