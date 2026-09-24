<script lang="ts">
  // #879 — one Task Nodes row's "export as a skill" checkbox.
  //
  // ONE FORM PER ROW, and both values it submits are LITERALS rendered from the
  // loader's data: the node id, and the state the click asks for (the opposite
  // of what is stored). Nothing is written on click, so the FormData cannot
  // carry a stale value (`hrn:node:hadronmemory.com:hadron-portal:review:submitted-value-must-not-be-written-on-click`,
  // #840). The checkbox only submits its own form.
  //
  // The action re-reads the node and computes the write from the STORED
  // properties; this component never sends a properties bag.
  import { enhance } from '$app/forms';
  import { SKILL_HOSTS, exportKeyList, hostLabel, taskExportNote, taskExportUnknownNote, type TaskExport } from '$lib/skill-export';
  import { t } from '$lib/i18n/t';
  import { saveSettled, saveStarted } from '$lib/skill-export-saves.svelte';

  interface Props {
    nodeId: string;
    memoryId: string;
    name: string;
    exportState: TaskExport;
  }

  let { nodeId, memoryId, name, exportState }: Props = $props();

  const on = $derived(exportState.kind === 'on');
  const editHref = $derived(`/app/memories/${memoryId}/nodes/${nodeId}/edit`);
  // A declaration covering fewer hosts than the checkbox writes: made in the
  // CLI or raw JSON, or written before Codex was a host (#867). Shown, never
  // silently widened — checking the box again is what writes every host.
  const missingHosts = $derived(
    exportState.kind === 'on' ? SKILL_HOSTS.filter((h) => !exportState.hosts.includes(h)) : [],
  );

  let pending = $state(false);
  let failure = $state<{ code: string; detail: string | null } | null>(null);

  // The same string the grid searches (`taskExportNote`), so what the row
  // shows is exactly what the search box finds it by.
  const note = $derived(taskExportNote(exportState));
  // server#1296: shown in EVERY state, the unchecked one above all — a task
  // declared only under a key no host reads is `none`, and this note is the
  // one place on the list that says why it is not exported.
  const unknownNote = $derived(taskExportUnknownNote(exportState));

  function failureText(f: { code: string; detail: string | null }): string {
    switch (f.code) {
      case 'divergent':
        return t('tasks.export.error.divergent', 'Its hosts are set differently — change them on the node.');
      case 'not-runnable':
        return t('tasks.export.error.not-runnable', 'It is no longer runnable, so it cannot be exported.');
      case 'legacy':
        return t('tasks.export.error.legacy', 'It uses the older export setting — change it on the node.');
      case 'unauthenticated':
        return t('tasks.export.error.unauthenticated', 'Your session has ended — sign in again.');
      case 'not-found':
        return t('tasks.export.error.not-found', 'The task could not be found — reload the page.');
      default:
        // `rejected` and `no-door` carry the server's (or the door chooser's)
        // own words, which say more than any paraphrase here.
        return f.detail ?? t('tasks.export.error.failed', 'The change could not be saved.');
    }
  }
</script>

{#if exportState.kind === 'divergent'}
  <!-- No checkbox: whichever side it showed, the next click would flatten the
       per-host setup to it. The edit page's raw properties show every host. -->
  <a
    href={editHref}
    class="text-xs text-amber-700 hover:underline dark:text-amber-400"
    title={t('tasks.export.divergent-title', 'Claude and Codex are set differently for this task. Change them on the node.')}
  >{note}</a>
{:else if exportState.kind === 'legacy'}
  <!-- #906: no checkbox. The server reads the retired top-level key as
       Claude's, and an `exports.claudeSkill` written by this box would win
       over it — a silent override. The server's own advice is to move it. -->
  <a
    href={editHref}
    class="text-xs text-amber-700 hover:underline dark:text-amber-400"
    title={t(
      'tasks.export.legacy-title',
      'Declared with the older top-level “skill” or “claudeSkill” setting. The server still reads it as Claude’s; move it to the current export setting on the node.',
    )}
  >{note}</a>
{:else}
  <form
    method="POST"
    action="?/setExport"
    class="flex items-center gap-2"
    use:enhance={({ formElement }) => {
      pending = true;
      failure = null;
      saveStarted();
      return async ({ result, update }) => {
        pending = false;
        if (result.type === 'failure') {
          const f = (result.data as { exportFailed?: { code: string; detail: string | null } } | undefined)?.exportFailed;
          failure = f ?? { code: 'failed', detail: null };
        } else if (result.type === 'error') {
          failure = { code: 'failed', detail: null };
        }
        // A refused change leaves the stored state as it was, and so does the
        // reload — but the BROWSER already flipped the box. Put it back, or the
        // row shows a state the node does not have.
        if (failure) {
          const box = formElement.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (box) box.checked = on;
        }
        try {
          await update({ reset: false });
        } finally {
          // After the reload, not before: the download must see the new state.
          saveSettled();
        }
      };
    }}
  >
    <input type="hidden" name="nodeId" value={nodeId} />
    <input type="hidden" name="enable" value={on ? 'false' : 'true'} />
    <input
      type="checkbox"
      checked={on}
      disabled={pending}
      aria-label={t('tasks.export.toggle-aria', 'Export “{name}” as a skill', { name })}
      aria-describedby={failure ? `export-error-${nodeId}` : undefined}
      class="h-4 w-4 rounded border-zinc-300 text-indigo-600 dark:border-zinc-600"
      onchange={(e) => e.currentTarget.form?.requestSubmit()}
    />
    {#if on && missingHosts.length > 0}
      <a
        href={editHref}
        class="text-xs text-zinc-500 hover:underline"
        title={t('tasks.export.partial-title', 'Not exported for {hosts}. Change it on the node.', {
          hosts: missingHosts.map(hostLabel).join(', '),
        })}
      >{note}</a>
    {/if}
  </form>
  {#if failure}
    <p id="export-error-{nodeId}" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{failureText(failure)}</p>
  {/if}
{/if}
{#if unknownNote}
  <a
    href={editHref}
    class="mt-1 block text-xs text-amber-700 hover:underline dark:text-amber-400"
    title={t(
      'tasks.export.unknown-title',
      'Only {keys} are export keys; nothing reads any other key under exports. Rename or remove it on the node.',
      { keys: exportKeyList() },
    )}
  >{unknownNote}</a>
{/if}
