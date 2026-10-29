<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import { bootSourceSchema } from './schema';

  type Source = Infer<typeof bootSourceSchema, 'zod4'>;
  type SourceForm = SuperValidated<Source, App.Superforms.Message>;
  let { urn, revision, approvedRevision, initial, submitted, canManage = null }: {
    urn: string; revision: number; approvedRevision: number | null;
    initial: SourceForm; submitted?: SourceForm | null; canManage?: boolean | null;
  } = $props();
  const seed = untrack(() => submitted ?? initial);
  const { form, errors, message, submitting, enhance, reset } = superForm(seed, {
    taintedMessage: t('agent.boot.unsaved', 'Discard your unsaved boot prompt?'),
    validators: zod4Client(bootSourceSchema), resetForm: false, clearOnSubmit: 'none', invalidateAll: 'force',
  });
  const stored = untrack(() => initial.data.content);
</script>

<section data-boot-prompt-source>
  <p class="mb-1 text-sm text-zinc-700 dark:text-zinc-300">{t('agent.boot.source-lead', 'This is the source of the boot prompt. Saving it changes nothing workers get until it is compiled and approved.')}</p>
  <p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
    {#if approvedRevision !== null}
      {t('agent.boot.approved-line', 'Workers get the approved compiled revision, revision {m}.', { m: approvedRevision })}
    {:else}
      {t('agent.boot.not-approved-line', 'No compiled revision is approved yet, so workers are not served this prompt.')}
    {/if}
  </p>
  <p class="mb-3 text-xs"><Urn value={urn} type="node" /> <span class="text-zinc-500 dark:text-zinc-400">{t('agent.boot.source-revision', 'revision {n}', { n: revision })}</span></p>
  <form method="POST" action="?/saveBootSource" use:enhance novalidate class="space-y-3">
    <input type="hidden" name="_kind" value={$form._kind} />
    <input type="hidden" name="nodeId" value={$form.nodeId} />
    <input type="hidden" name="expectedRevision" value={$form.expectedRevision} />
    <label for="bootSourceText" class="sr-only">{t('agent.boot.source-label', 'Boot prompt source')}</label>
    <textarea id="bootSourceText" name="content" bind:value={$form.content} rows="24" readonly={canManage === false} aria-invalid={!!$errors.content?.length} class="w-full rounded-lg border border-zinc-300 bg-white p-4 font-mono text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"></textarea>
    {#if canManage !== false}
      <div class="flex justify-end gap-2">
        <button type="button" disabled={$submitting} onclick={() => reset({ data: { ...$form, content: stored } })} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">{t('agent.boot.cancel', 'Cancel')}</button>
        <button type="submit" disabled={$submitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{$submitting ? t('agent.boot.saving', 'Saving...') : t('agent.boot.save', 'Save')}</button>
      </div>
    {/if}
  </form>
  {#if $message}<p role={$message.type === 'error' ? 'alert' : 'status'} class="mt-3 text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$message.text}</p>{/if}
</section>
