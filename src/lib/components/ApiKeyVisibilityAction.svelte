<script lang="ts">
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import NodeActionsMenu from './NodeActionsMenu.svelte';
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
  import { t } from '$lib/i18n/t';
  type Notice = { type: 'success' | 'error'; text: string };
  // onstart runs only for an ACCEPTED submit (never a cancelled duplicate) and
  // returns where that submit's result goes, and whether the page is still on
  // the view the submit started in.
  // ondelete (portal#1011 P2) adds Delete to this row's menu; the page owns the dialog.
  let { id, preview, hidden, includeHidden, onstart, ondelete }: {
    id: string; preview: string; hidden: boolean; includeHidden: boolean; ondelete?: () => void;
    onstart: (form: HTMLFormElement) => { deliver: (notice: Notice) => void; current: () => boolean; apply: () => boolean; settled: (success: boolean) => void };
  } = $props();
  let formEl: HTMLFormElement;
  let pending = $state(false);
  const label = $derived(hidden ? i18n.unhide() : i18n.hide());
  const submit: SubmitFunction = ({ cancel }) => {
    if (pending) { cancel(); return; }
    pending = true;
    const { deliver, apply, settled } = onstart(formEl);
    return async ({ result, update }) => {
      let success = false;
      try {
        if (result.type === 'success' || result.type === 'failure') {
          // deliver() drops a notice whose page scope ended (another view, or
          // the page was destroyed).
          if (result.data?.visibility) deliver(result.data.visibility as Notice);
          // The write landed, so a success refreshes whatever page is current.
          // Refresh here rather than in kit's update, which would refresh and
          // then apply with no check between: the scope can end during it.
          if (result.type === 'success') await invalidateAll();
          // Never apply a reply whose scope ended: kit would set the CURRENT
          // page's form (its action match ignores the query) and reset focus,
          // so the old result would surface there (#1500). Nor while a Delete
          // dialog opened after it: Kit's focus reset would take that dialog's
          // focus (#1652 item 5). Its notice was already delivered above.
          if (!apply()) return;
          await update({ reset: false, invalidateAll: false });
          await tick();
          success = result.type === 'success';
          return;
        }
        if (result.type === 'error') {
          deliver({type:'error', text:i18n.visibilityFailed()});
          return;
        }
        await update({ reset: false, invalidateAll: false });
      } finally { pending = false; settled(success); }
    };
  };
</script>
<form method="POST" action={includeHidden ? '?/visibility&includeHidden=true' : '?/visibility'} use:enhance={submit} bind:this={formEl}>
  <!-- Literal per-row values: no click-time state can leak another key's id. -->
  <input type="hidden" name="id" value={id} />
  <input type="hidden" name="hidden" value={hidden ? 'false' : 'true'} />
  <NodeActionsMenu actions={[{id:'visibility',label}, ...(ondelete ? [{id:'delete',label:i18n.deleteAction(),danger:true}] : [])]}
    onselect={(action) => action === 'delete' ? ondelete?.() : formEl.requestSubmit()}
    label={t('api-keys.actions.label', 'Actions for key …{key}', {key:preview})} disabled={pending} fixed compact />
  <!-- Mounted empty before any submit so the pending text lands in a region already observed (#1359). -->
  <span role="status" class="text-xs text-zinc-500 dark:text-zinc-400">{pending ? i18n.saving() : ''}</span>
  <noscript><button type="submit">{label}</button></noscript>
</form>
