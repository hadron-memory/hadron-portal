<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import NodeActionsMenu from './NodeActionsMenu.svelte';
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
  import { t } from '$lib/i18n/t';
  let { id, preview, hidden, includeHidden, onresult }: {
    id: string; preview: string; hidden: boolean; includeHidden: boolean;
    onresult: (notice: { type: 'success' | 'error'; text: string }) => void;
  } = $props();
  let formEl: HTMLFormElement;
  let pending = $state(false);
  const label = $derived(hidden ? i18n.unhide() : i18n.hide());
  const submit: SubmitFunction = ({ cancel }) => {
    if (pending) { cancel(); return; }
    pending = true;
    return async ({ result, update }) => {
      try {
        if ((result.type === 'success' || result.type === 'failure') && result.data?.visibility) {
          onresult(result.data.visibility as {type: 'success' | 'error'; text: string});
        } else if (result.type === 'error') {
          onresult({type:'error', text:i18n.visibilityFailed()});
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
  {#if pending}<span role="status" class="text-xs text-zinc-500 dark:text-zinc-400">{i18n.saving()}</span>{/if}
  <noscript><button type="submit">{label}</button></noscript>
</form>
