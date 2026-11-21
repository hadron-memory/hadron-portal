<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { t } from '$lib/i18n/t';
  import type { bootStartSchema } from './schema';

  type StartForm = SuperValidated<Infer<typeof bootStartSchema, 'zod4'>, App.Superforms.Message>;
  // portal#1378. `seeded`: a compiled prompt exists, so the source starts as a copy of it (case 1).
  // Otherwise the Agent has no boot prompt and the source starts empty (case 2), which changes what
  // workers are served once approved, so that case asks first.
  let { seeded, canManage = null, initial, submitted }: {
    seeded: boolean; canManage?: boolean | null; initial: StartForm; submitted?: StartForm | null;
  } = $props();
  const { message, submitting, enhance } = superForm(untrack(() => submitted ?? initial), { resetForm: false, clearOnSubmit: 'none', invalidateAll: 'force' });
  let confirming = $state(false);
</script>

<section data-boot-start class="mb-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
  {#if seeded}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('boot.start.lead-seeded', 'This Agent has a boot prompt but no source to edit. Start a source from the current prompt, then edit and update it.')}</p>
  {:else}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('boot.start.lead-empty', 'This Agent has no boot prompt yet. Start a source to write one.')}</p>
  {/if}
  {#if canManage !== false}
    <form method="POST" action="?/startBootSource" use:enhance class="mt-3 space-y-3">
      <input type="hidden" name="_kind" value="bootStart" />
      <LiveRegion>
        {#if confirming && !seeded}
          <p data-boot-start-confirm class="text-sm text-zinc-700 dark:text-zinc-300">{t('boot.start.confirm', 'Once you compile and approve a revision, workers can be served it. Nothing changes until you do.')}</p>
        {/if}
      </LiveRegion>
      <div class="flex gap-2">
        {#if seeded || confirming}
          <button type="submit" disabled={$submitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">{$submitting ? t('boot.start.running', 'Starting...') : t('boot.start.button', 'Start a source')}</button>
          {#if confirming}<button type="button" disabled={$submitting} onclick={() => (confirming = false)} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">{t('boot.start.cancel', 'Cancel')}</button>{/if}
        {:else}
          <button type="button" onclick={() => (confirming = true)} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950">{t('boot.start.button', 'Start a source')}</button>
        {/if}
      </div>
    </form>
  {/if}
  {#if $message}<p role={$message.type === 'error' ? 'alert' : 'status'} class="mt-3 text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$message.text}</p>{/if}
</section>
