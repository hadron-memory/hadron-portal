<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import NodeActionsMenu from './NodeActionsMenu.svelte';
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
  import { t } from '$lib/i18n/t';
  type Notice = { type: 'success' | 'error'; text: string };
  // onstart runs only for an ACCEPTED submit (never a cancelled duplicate) and
  // returns where that submit's result goes.
  let { id, preview, hidden, includeHidden, onstart }: {
    id: string; preview: string; hidden: boolean; includeHidden: boolean;
    onstart: () => (notice: Notice) => void;
  } = $props();
  let formEl: HTMLFormElement;
  let pending = $state(false);
  const label = $derived(hidden ? i18n.unhide() : i18n.hide());
  const submit: SubmitFunction = ({ cancel }) => {
    if (pending) { cancel(); return; }
    pending = true;
    const deliver = onstart();
    return async ({ result, update }) => {
      try {
        if ((result.type === 'success' || result.type === 'failure') && result.data?.visibility) {
          deliver(result.data.visibility as Notice);
        } else if (result.type === 'error') {
          deliver({type:'error', text:i18n.visibilityFailed()});
          return;
        }
        await update({ reset: false, invalidateAll: result.type === 'success' });
      } finally { pending = false; }
    };
  };
</script>
<form method="POST" action={includeHidden ? '?/visibility&includeHidden=true' : '?/visibility'} use:enhance={submit} bind:this={formEl}>
  <!-- Literal per-row values: no click-time state can leak another key's id. -->
  <input type="hidden" name="id" value={id} />
  <input type="hidden" name="hidden" value={hidden ? 'false' : 'true'} />
  <NodeActionsMenu actions={[{id:'visibility',label}]} onselect={() => formEl.requestSubmit()}
    label={t('api-keys.actions.label', 'Actions for key …{key}', {key:preview})} disabled={pending} fixed compact />
  <!-- Mounted empty before any submit so the pending text lands in a region already observed (#1359). -->
  <span role="status" class="text-xs text-zinc-500 dark:text-zinc-400">{pending ? i18n.saving() : ''}</span>
  <noscript><button type="submit">{label}</button></noscript>
</form>
