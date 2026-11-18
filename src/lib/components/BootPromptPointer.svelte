<!--
  portal#1142 S8 — one boot-prompt pointer: what the server shows of it, and
  (when the viewer may be its manager) a form to set or clear it
  (hadron-server#2219, R23–R27; Xylon's stamp 6330444824).

  - A set pointer is a URN chip
    (hrn:node:hadronmemory.com:hadron-portal:review:render-urn). A null pair
    is "Not shown": unset and masked look the same, so it never says "no
    pointer". A failed read says so.
  - The form is a presentation hint only: hidden on an explicit
    `canManage === false`, offered otherwise. The server's setter decides.
  - Set sends the typed text; Clear sends an explicit null. A refusal keeps
    the typed value and shows the server's message whole, after a fixed lead.
  - Every control says what agents start with: the highest pointer's
    compiled prompt, newest approved revision (portal#1399).
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { POINTER_SERVED, pointerView, type PointerRead, type PointerResult } from '$lib/boot-prompt-pointer';

  let {
    read,
    canManage,
    action,
    hidden = {},
    result = null,
    idPrefix,
  }: {
    read: PointerRead | undefined;
    canManage: boolean | null;
    action: string;
    hidden?: Record<string, string>;
    /** This surface's own action result, already matched to it by the page. */
    result?: PointerResult | null;
    idPrefix: string;
  } = $props();

  const view = $derived(pointerView(read));
  // Seeded from a refused submit so nothing typed is lost (the page re-mounts
  // this per surface, so one surface's draft never shows on another).
  // svelte-ignore state_referenced_locally
  let nodeRef = $state(result?.refusal ? (result.nodeRef ?? '') : '');
  let submitting = $state(false);

  const submit = () => {
    submitting = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      submitting = false;
    };
  };
</script>

<div class="space-y-2 text-sm" data-testid="boot-pointer">
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    {#if view.kind === 'set' || view.kind === 'deleted'}
      <span class="min-w-0"><Urn value={view.ref} type="node" /></span>
    {:else if view.kind === 'not-shown'}
      <span class="text-zinc-500 dark:text-zinc-400" data-pointer-state="not-shown">{t('boot-pointer.not-shown', 'Not shown')}</span>
    {:else}
      <span class="text-zinc-500 dark:text-zinc-400" data-pointer-state="unavailable">{t('boot-pointer.unavailable', 'Couldn’t load the pointer.')}</span>
    {/if}
  </div>
  {#if view.kind === 'deleted'}
    <p class="text-amber-800 dark:text-amber-300" data-pointer-state="deleted">{t('boot-pointer.deleted', 'The target was deleted; clear or repoint it.')}</p>
  {/if}
  <p class="text-xs text-zinc-500 dark:text-zinc-400">{POINTER_SERVED()}</p>

  {#if canManage !== false}
    <form method="POST" {action} use:enhance={submit} class="space-y-2">
      {#each Object.entries(hidden) as [name, value] (name)}
        <input type="hidden" {name} {value} />
      {/each}
      <label for="{idPrefix}-node-ref" class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('boot-pointer.field', 'Compiled boot prompt (node id or URN)')}
      </label>
      <input
        id="{idPrefix}-node-ref"
        name="nodeRef"
        type="text"
        bind:value={nodeRef}
        aria-describedby={result?.refusal ? `${idPrefix}-refusal` : undefined}
        class="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {#if result?.refusal}
        <div id="{idPrefix}-refusal" role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" data-testid="boot-pointer-refusal">
          {#if result.refusal.lead}<p class="font-semibold">{result.refusal.lead}</p>{/if}
          <p>{result.refusal.message}</p>
          {#if result.refusal.code}<code class="font-mono opacity-80">{result.refusal.code}</code>{/if}
        </div>
      {:else if result?.ok}
        <p role="status" class="text-xs text-green-700 dark:text-green-300">
          {result.cleared ? t('boot-pointer.done.cleared', 'Pointer cleared.') : t('boot-pointer.done.set', 'Pointer set.')}
        </p>
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" name="intent" value="set" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {t('boot-pointer.set', 'Set pointer')}
        </button>
        <button type="submit" name="intent" value="clear" disabled={submitting} class="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {t('boot-pointer.clear', 'Clear')}
        </button>
      </div>
    </form>
  {/if}
</div>
