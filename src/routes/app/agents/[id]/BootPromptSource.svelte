<script lang="ts">
  import LiveOutcome from '$lib/components/LiveOutcome.svelte';
  import BootProvenance from '$lib/components/BootProvenance.svelte';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import { invalidateAll } from '$app/navigation';
  import { approvalText } from '$lib/node-approval';
  import type { CompiledView, SourceView } from '$lib/server/boot-source';
  import BootSourceLint from './BootSourceLint.svelte';
  import { bootApproveSchema, bootCompileSchema } from './schema';

  // portal#1485: the tab explains the boot prompt and walks its workflow. The source is
  // edited on its own node page, like any other node; Compile and Approve stay here.
  type CompileForm = SuperValidated<Infer<typeof bootCompileSchema, 'zod4'>, App.Superforms.Message>;
  type ApproveForm = SuperValidated<Infer<typeof bootApproveSchema, 'zod4'>, App.Superforms.Message>;
  let { agentId, shown = true, source, compiled, compileInitial, approveInitial, compileSubmitted, approveSubmitted, canManage = null, noPointer = false, showProvenance = true }: {
    agentId: string; shown?: boolean;
    source: SourceView; compiled: CompiledView | null;
    compileInitial: CompileForm; approveInitial: ApproveForm;
    compileSubmitted?: CompileForm | null; approveSubmitted?: ApproveForm | null;
    canManage?: boolean | null; noPointer?: boolean; showProvenance?: boolean;
  } = $props();
  const approvedRevision = $derived(compiled?.approvedRevision ?? null);
  const nodeHref = (memoryId: string, id: string) => `/app/memories/${encodeURIComponent(memoryId)}/nodes/${encodeURIComponent(id)}`;
  const sourceHref = $derived(nodeHref(source.memoryId, source.id));
  // The server returns compiled lint only to whoever may compile, and the warning's
  // remedy is a compile, so it is shown only to a manager (hrn:node:hadronmemory.com:specs:cor:agt:040:13).
  const outdated = $derived(canManage !== false && !!compiled?.lint?.items.some((w) => w.kind === 'RECOMPILE_AVAILABLE'));

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

  // Step 1: the source was edited in another tab; Refresh reads it, and the compiled
  // prompt's status, again.
  let refreshing = $state(false);
  let refreshFailed = $state(false);
  // invalidateAll() can reject (SvelteKit's _invalidate has no catch of its own), and
  // this handler is never awaited, so a rejection would be unhandled and silent (#1912).
  // Pressing Refresh again is the retry.
  async function refresh() {
    refreshing = true; refreshFailed = false;
    try { await invalidateAll(); } catch { refreshFailed = true; } finally { refreshing = false; }
  }

  const stepClass = 'rounded-lg border border-zinc-200 p-4 dark:border-zinc-800';
  const stepTitle = 'text-sm font-semibold text-zinc-900 dark:text-white';
  const stepText = 'mt-1 text-sm text-zinc-600 dark:text-zinc-400';
  const linkButton = 'inline-flex items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-indigo-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-indigo-300 dark:hover:bg-zinc-900';
</script>

<section data-boot-prompt-source class="max-w-3xl space-y-4">
  <div data-boot-intro class="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
    <p>{t('agent.boot.intro', 'The boot prompt is what a worker of this Agent reads when it starts. You write its source as a node. Compiling the source fills in its includes and writes a new revision of the compiled prompt, and an approved compiled revision is the one ready to serve.')}</p>
    <p>
      {t('agent.boot.intro-how', 'To change it, follow the steps below.')}
      <a href="https://docs.hadronmemory.com/reference/compile-boot-prompt/" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline dark:text-indigo-400">{t('agent.boot.docs', 'How boot prompts are compiled')}</a>
      ·
      <a href="https://docs.hadronmemory.com/reference/boot-prompt-pointers/" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline dark:text-indigo-400">{t('agent.boot.docs-pointers', 'Boot-prompt pointers')}</a>
    </p>
  </div>

  {#if outdated}
    <p data-boot-outdated role="status" class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">{t('agent.boot.outdated', 'The source has changed since this prompt was compiled. Compile again to pick up the newer revision.')}</p>
  {/if}

  <ol data-boot-steps class="space-y-3">
    <li data-boot-step="edit" class={stepClass}>
      <h3 class={stepTitle}>{t('agent.boot.step-edit', '1. Edit the source')}</h3>
      <p class={stepText}>{t('agent.boot.step-edit-text', 'The source opens on its own page in a new tab. Edit it there like any other node, then come back here and press Refresh to see the new revision.')}</p>
      <div class="mt-2 text-xs"><Urn value={source.urn} type="node" /> <span class="text-zinc-500 dark:text-zinc-400">{t('agent.boot.source-revision', 'revision {n}', { n: source.revision })}</span></div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <a data-boot-edit href={sourceHref} target="_blank" rel="noopener noreferrer" class={linkButton}>{canManage === false ? t('agent.boot.open-source', 'Open the source') : t('agent.boot.edit-source', 'Edit the source')}</a>
        <button type="button" onclick={refresh} disabled={refreshing} aria-busy={refreshing} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">{refreshing ? t('agent.boot.refreshing', 'Refreshing...') : t('agent.boot.refresh', 'Refresh')}</button>
      </div>
      <!-- Always mounted: a live region that is inserted already holding its text is not reliably announced. -->
      <p data-boot-refresh-error role="alert" class="text-sm text-red-600 dark:text-red-400" class:mt-2={refreshFailed}>{#if refreshFailed}{t('agent.boot.refresh-failed', 'Couldn’t refresh. Press Refresh to try again.')}{/if}</p>
      <BootSourceLint {agentId} nodeId={source.id} {shown} refresh={0} savedText={source.content} savedRevision={source.revision} />
    </li>

    <li data-boot-step="review" class={stepClass}>
      <h3 class={stepTitle}>{t('agent.boot.step-review', '2. Review the source (optional)')}</h3>
      <p class={stepText}>{t('agent.boot.step-review-text', 'You can approve the source on its page. This is optional: a compile reads the newest revision of the source, approved or not.')}</p>
      <p data-boot-source-approval class="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
        {#if source.approval.state === 'APPROVED' && source.approval.approval}
          {t('agent.boot.source-approved', 'Revision {n} of the source is approved.', { n: source.approval.approval.revision })}
        {:else}
          {approvalText(source.approval)}
        {/if}
      </p>
      <div class="mt-3"><a href={sourceHref} target="_blank" rel="noopener noreferrer" class={linkButton}>{t('agent.boot.review-source', 'Review the source')}</a></div>
    </li>

    <li data-boot-step="compile" class={stepClass}>
      <h3 class={stepTitle}>{t('agent.boot.step-compile', '3. Compile')}</h3>
      <p class={stepText}>{t('agent.boot.step-compile-text', 'Compiling writes a new revision of the compiled prompt from the source. Nothing new is served until that revision is approved.')}</p>
      {#if canManage !== false}
        <form method="POST" action="?/compileBootPrompt" use:compileEnhance class="mt-3">
          <input type="hidden" name="_kind" value="bootCompile" />
          <button type="submit" disabled={$compileSubmitting} class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{$compileSubmitting ? t('boot.compile.running', 'Compiling...') : t('boot.compile.button', 'Compile')}</button>
        </form>
      {/if}
      <LiveOutcome failed={$compileMessage?.type === 'error'}>
        {#if $compileMessage}<p class="mt-3 text-sm {$compileMessage.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$compileMessage.text}</p>{/if}
      </LiveOutcome>
    </li>

    <li data-boot-step="approve" class={stepClass}>
      <h3 class={stepTitle}>{t('agent.boot.step-approve', '4. Approve the compiled prompt')}</h3>
      <div class="mt-1 space-y-3">
        {#if compiled === null && noPointer}
          <p class={stepText}>{t('agent.boot.not-compiled-line', 'This source has not been compiled yet, so workers are not served it.')}</p>
        {:else if compiled === null}
          <p class={stepText}>{t('agent.boot.approval-unknown', 'Couldn’t load the approval status of the compiled prompt.')}</p>
        {:else}
          {#if compiled.pending}
            <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {#if approvedRevision !== null}
                {t('boot.approve.pending', 'Revision {n} is ready but not approved. Workers still get revision {m}.', { n: compiled.revision, m: approvedRevision })}
              {:else}
                {t('boot.approve.pending-none', 'Revision {n} is ready but not approved. Workers are not served a prompt until it is.', { n: compiled.revision })}
              {/if}
            </p>
          {:else if approvedRevision === null}
            <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('agent.boot.not-approved-line', 'No compiled revision is approved yet, so workers are not served this prompt.')}</p>
          {:else if compiled.revision > approvedRevision}
            <p data-boot-unchanged class={stepText}>{t('boot.compile.same-text', 'Revision {n} has the same text as revision {m}, so there is nothing to approve.', { n: compiled.revision, m: approvedRevision })}</p>
          {:else}
            <p class={stepText}>{t('agent.boot.approved-line', 'Revision {m} is approved and ready to serve.', { m: approvedRevision })}</p>
          {/if}
          <div class="text-xs"><Urn value={compiled.urn} type="node" /></div>
          {#if compiled.pending}
            <section data-boot-approve aria-label={t('boot.approve.panel-label', 'Revision to approve')} class="space-y-3 rounded-lg border border-amber-300 p-4 dark:border-amber-700">
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
          <div><a data-boot-compiled-link href={nodeHref(compiled.memoryId, compiled.id)} target="_blank" rel="noopener noreferrer" class={linkButton}>{t('agent.boot.open-compiled', 'Open the compiled prompt')}</a></div>
        {/if}
        <LiveOutcome failed={$approveMessage?.type === 'error'}>
          {#if $approveMessage}<p class="text-sm {$approveMessage.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$approveMessage.text}</p>{/if}
        </LiveOutcome>
      </div>
    </li>
  </ol>
  {#if compiled && showProvenance}{#key `${compiled.id}:${compiled.revision}`}<BootProvenance nodeId={compiled.id} revision={compiled.revision} />{/key}{/if}
</section>
