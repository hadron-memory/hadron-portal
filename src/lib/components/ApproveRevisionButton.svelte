<!--
  #1002 — the node page's Approve control. It is the one action on the approval
  row, so it is a filled button with a checkmark, and `inline-flex items-center`
  keeps icon and label on one centre line beside the "Not minted" / "Not
  approved" labels, which share that row.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { revision, submitting = false }: { revision: number | string | null | undefined; submitting?: boolean } = $props();
</script>

<button
  type="submit"
  data-testid="approve-revision"
  disabled={submitting}
  class="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
>
  <svg data-testid="approve-check" aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 shrink-0">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" />
  </svg>
  {t('node.approval.approve', 'Approve revision {rev}', { rev: revision ?? '' })}
</button>
