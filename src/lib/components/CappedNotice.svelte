<script lang="ts">
  // hadron-server#2211 / portal#1226: a read that has no continuation (it takes a
  // limit but no offset or cursor) fetches one window. When the window came back
  // full there may be more behind it, and a view that quietly presents the window
  // as the whole set is wrong in a way no one can see. This says so.
  import { t } from '$lib/i18n/t';

  let { shown, what }: { shown: number; what: string } = $props();
</script>

<p
  role="status"
  class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
>
  {t('capped.notice', 'Showing the first {shown} {what}; more may exist and are not listed here.', { shown, what })}
</p>
