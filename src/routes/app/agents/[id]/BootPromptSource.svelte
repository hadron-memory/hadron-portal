<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { CompiledView } from '$lib/server/boot-source';
  import BootSourceLint from './BootSourceLint.svelte';
  import BootSourceResolved from './BootSourceResolved.svelte';
  import { bootApproveSchema, bootCompileSchema, bootSourceSchema } from './schema';

  type Source = Infer<typeof bootSourceSchema, 'zod4'>;
  type SourceForm = SuperValidated<Source, App.Superforms.Message>;
  type CompileForm = SuperValidated<Infer<typeof bootCompileSchema, 'zod4'>, App.Superforms.Message>;
  type ApproveForm = SuperValidated<Infer<typeof bootApproveSchema, 'zod4'>, App.Superforms.Message>;
  let { agentId, shown = true, view = $bindable('source'), urn, revision, compiled, initial, compileInitial, approveInitial, submitted, compileSubmitted, approveSubmitted, canManage = null, noPointer = false }: {
    agentId: string; shown?: boolean; view?: 'source' | 'resolved';
    urn: string; revision: number; compiled: CompiledView | null;
    initial: SourceForm; compileInitial: CompileForm; approveInitial: ApproveForm;
    submitted?: SourceForm | null; compileSubmitted?: CompileForm | null; approveSubmitted?: ApproveForm | null;
    canManage?: boolean | null; noPointer?: boolean;
  } = $props();
  const approvedRevision = $derived(compiled?.approvedRevision ?? null);
  // A refused save keeps its draft and the revision it was written against. A saved
  // one is seeded from the refreshed loader data: the posted form still carries the
  // revision before the save, so the next save would conflict with the user's own.
  const seed = untrack(() => (submitted && submitted.message?.type === 'error' ? submitted : submitted ? { ...initial, message: submitted.message } : initial));
  const { form, errors, message, submitting, enhance, reset } = superForm(seed, {
    taintedMessage: t('agent.boot.unsaved', 'Discard your unsaved boot prompt?'),
    validators: zod4Client(bootSourceSchema), resetForm: false, clearOnSubmit: 'none', invalidateAll: 'force',
    // A saved source remounts this view on its new revision, which re-reads both. A refused
    // save doesn't, and a conflict means what they show is out of date.
    onResult: ({ result }) => { if (result.type === 'failure') savedChanged += 1; },
  });
  let savedChanged = $state(0);
  const stored = untrack(() => initial.data.content);
  const storedRevision = untrack(() => initial.data.expectedRevision);
  // The compile reads the STORED source, so compiling with an unsaved draft would build the old text.
  const dirty = $derived($form.content !== stored);
  const compile = superForm(untrack(() => compileSubmitted ?? compileInitial), { resetForm: false, clearOnSubmit: 'none', invalidateAll: 'force' });
  const approve = superForm(untrack(() => approveSubmitted ?? approveInitial), {
    resetForm: false, clearOnSubmit: 'none', invalidateAll: 'force',
    // A revision that moved on under the manager: the page reloads with the newest one.
    onResult: ({ result }) => { if (result.type === 'failure' && result.status === 409) void invalidateAll(); },
  });
  // Approve's node id and revision are read from the displayed compiled view, never from
  // the form store: the store is seeded once, so it would keep the revision from before a
  // reload and the panel would show one revision while Approve submitted another.
  const compileMessage = compile.message, compileSubmitting = compile.submitting, compileEnhance = compile.enhance;
  const approveMessage = approve.message, approveSubmitting = approve.submitting, approveEnhance = approve.enhance;
  // A compile or approval response reloads the page data, which would replace anything typed
  // meanwhile with the saved source. Editing waits for the response: the textarea turns
  // read-only (aria-busy) and Save/Cancel are disabled, so no input is accepted and then lost.
  const busy = $derived($compileSubmitting || $approveSubmitting);
</script>

<section data-boot-prompt-source>
  <p class="mb-1 text-sm text-zinc-700 dark:text-zinc-300">{t('agent.boot.source-lead', 'This is the source of the boot prompt. Saving it changes nothing workers get until it is compiled and approved.')}</p>
  <p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
    {#if compiled === null && noPointer}
      {t('agent.boot.not-compiled-line', 'This source has not been compiled yet, so workers are not served it.')}
    {:else if compiled === null}
      {t('agent.boot.approval-unknown', 'Couldn’t load the approval status of the compiled prompt.')}
    {:else if compiled.approvedRevision !== null}
      {t('agent.boot.approved-line', 'Workers get revision {m}, the approved compiled prompt.', { m: compiled.approvedRevision })}
    {:else}
      {t('agent.boot.not-approved-line', 'No compiled revision is approved yet, so workers are not served this prompt.')}
    {/if}
  </p>
  <p class="mb-3 text-xs"><Urn value={urn} type="node" /> <span class="text-zinc-500 dark:text-zinc-400">{t('agent.boot.source-revision', 'revision {n}', { n: revision })}</span></p>
  <div role="group" aria-label={t('agent.boot.view-label', 'How the source is shown')} class="mb-3 inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
    <button type="button" aria-pressed={view === 'source'} onclick={() => (view = 'source')} class="px-2.5 py-1 text-xs {view === 'source' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}">{t('agent.boot.view-source', 'Source')}</button>
    <button type="button" aria-pressed={view === 'resolved'} onclick={() => (view = 'resolved')} class="px-2.5 py-1 text-xs {view === 'resolved' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}">{t('agent.boot.view-resolved', 'As readers see it')}</button>
  </div>
  <form method="POST" action="?/saveBootSource" use:enhance novalidate class="space-y-3">
    <input type="hidden" name="_kind" value={$form._kind} />
    <input type="hidden" name="nodeId" value={$form.nodeId} />
    <input type="hidden" name="expectedRevision" value={$form.expectedRevision} />
    <label for="bootSourceText" class="sr-only">{t('agent.boot.source-label', 'Boot prompt source')}</label>
    <!-- Hidden, never removed: the draft lives here, and a save always posts this raw text. -->
    <div hidden={view !== 'source'}><textarea id="bootSourceText" name="content" bind:value={$form.content} rows="24" readonly={canManage === false || busy} aria-busy={busy} aria-invalid={!!$errors.content?.length} class="w-full rounded-lg border border-zinc-300 bg-white p-4 font-mono text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"></textarea></div>
    <div hidden={view !== 'resolved'}>
      <BootSourceResolved {agentId} nodeId={$form.nodeId} openedRevision={$form.expectedRevision} {dirty} shown={shown && view === 'resolved'} refresh={savedChanged} />
    </div>
    <!-- Both act on the draft, which the resolved view doesn't show. -->
    {#if canManage !== false && view === 'source'}
      <div class="flex justify-end gap-2">
        <button type="button" disabled={$submitting || busy} onclick={() => reset({ data: { ...$form, content: stored } })} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">{t('agent.boot.cancel', 'Cancel')}</button>
        <button type="submit" disabled={$submitting || busy} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">{$submitting ? t('agent.boot.saving', 'Saving...') : t('agent.boot.save', 'Save')}</button>
      </div>
    {/if}
  </form>
  <BootSourceLint {agentId} nodeId={$form.nodeId} {shown} refresh={savedChanged} savedText={stored} savedRevision={storedRevision} />
  {#if canManage !== false}
    <form method="POST" action="?/compileBootPrompt" use:compileEnhance class="mt-6 flex items-center gap-3">
      <input type="hidden" name="_kind" value="bootCompile" />
      <button type="submit" disabled={$compileSubmitting || dirty} aria-describedby={dirty ? 'bootSaveFirst' : undefined} class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{$compileSubmitting ? t('boot.compile.running', 'Building...') : t('boot.compile.button', 'Update the prompt workers get')}</button>
      {#if dirty}<span id="bootSaveFirst" class="text-xs text-zinc-500 dark:text-zinc-400">{t('boot.compile.save-first', 'Save your changes first.')}</span>{/if}
    </form>
  {/if}
  {#if $compileMessage}<p role={$compileMessage.type === 'error' ? 'alert' : 'status'} class="mt-3 text-sm {$compileMessage.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$compileMessage.text}</p>{/if}
  {#if compiled && !compiled.pending && approvedRevision !== null && compiled.revision > approvedRevision}
    <p data-boot-unchanged class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t('boot.compile.same-text', 'Revision {n} has the same text as revision {m}, so there is nothing to approve.', { n: compiled.revision, m: approvedRevision })}</p>
  {/if}
  {#if compiled?.pending}
    <section data-boot-approve class="mt-6 space-y-3 rounded-lg border border-amber-300 p-4 dark:border-amber-700">
      <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {#if approvedRevision !== null}
          {t('boot.approve.pending', 'Revision {n} is ready but not approved. Workers still get revision {m}.', { n: compiled.revision, m: approvedRevision })}
        {:else}
          {t('boot.approve.pending-none', 'Revision {n} is ready but not approved. Workers are not served a prompt until it is.', { n: compiled.revision })}
        {/if}
      </p>
      <p class="text-xs"><Urn value={compiled.urn} type="node" /></p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex: a scrollable text region must be reachable by keyboard (WCAG 2.1.1) -->
      <pre data-boot-compiled tabindex="0" aria-label={t('boot.approve.text-label', 'Compiled prompt text')} class="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">{compiled.content}</pre>
      {#if compiled.lint}
        <div data-boot-lint>
          <p class="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('boot.lint.title', 'Warnings ({total})', { total: compiled.lint.total })}</p>
          <ul class="mt-1 list-disc pl-5 text-xs text-zinc-700 dark:text-zinc-300">
            {#each compiled.lint.items as w, i (`${w.position}:${w.kind}:${i}`)}<li>{w.text}</li>{/each}
          </ul>
          {#if compiled.lint.total > compiled.lint.items.length}<p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('boot.lint.more', '{n} more', { n: compiled.lint.total - compiled.lint.items.length })}</p>{/if}
        </div>
      {/if}
      {#if canManage !== false}
        <form method="POST" action="?/approveBootPrompt" use:approveEnhance class="flex justify-end">
          <input type="hidden" name="_kind" value="bootApprove" />
          <input type="hidden" name="nodeId" value={compiled.id} />
          <input type="hidden" name="revision" value={compiled.revision} />
          <button type="submit" disabled={$approveSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">{$approveSubmitting ? t('boot.approve.running', 'Approving...') : t('boot.approve.button', 'Approve')}</button>
        </form>
      {/if}
    </section>
  {/if}
  {#if $approveMessage}<p role={$approveMessage.type === 'error' ? 'alert' : 'status'} class="mt-3 text-sm {$approveMessage.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$approveMessage.text}</p>{/if}
  {#if $message}<p role={$message.type === 'error' ? 'alert' : 'status'} class="mt-3 text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$message.text}</p>{/if}
</section>
