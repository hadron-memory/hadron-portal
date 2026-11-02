<!--
  portal#1052 — a mono value with a copy button: a task id, or the CLI line
  that reads it (`hadron team task get <id>`). Tasks have no URN, so the id is
  what a reader pastes.

  portal#1415 item 2: an optional short VISIBLE name ("Handle", "ID", "CLI")
  for rows that stack — the task detail page has three of these, and without
  a name a sighted reader sees three "Copy" buttons that differ only by what
  sits beside them. The button keeps its own aria-label ("Copy the task
  handle"), which contains its visible text "Copy" (Label in Name) and the
  name word.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { value, label, name }: { value: string; label: string; name?: string } = $props();
  let copied = $state(false);

  function copy() {
    // Undefined outside secure contexts: bail rather than throw.
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        copied = true;
        setTimeout(() => (copied = false), 2000);
      })
      .catch((e) => console.error('Failed to copy', e));
  }
</script>

<span class="inline-flex min-w-0 max-w-full items-center gap-1">
  {#if name}<span data-copy-name class="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">{name}</span>{/if}
  <code class="min-w-0 truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{value}</code>
  <button
    type="button"
    onclick={copy}
    aria-label={label}
    title={label}
    class="shrink-0 rounded px-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
  >{copied ? t('app.tasks.copied', 'Copied') : t('app.tasks.copy', 'Copy')}</button>
</span>
