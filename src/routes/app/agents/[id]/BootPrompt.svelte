<script lang="ts">
  import { untrack } from 'svelte';
  import { Marked } from 'marked';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { t } from '$lib/i18n/t';
  import { renderNodeMarkdown } from '$lib/markdown/node-renderer';
  import { bootPromptSchema } from './schema';

  type Prompt = Infer<typeof bootPromptSchema, 'zod4'>;
  type PromptForm = SuperValidated<Prompt, App.Superforms.Message>;
  let { stored, initial, submitted, canManage = null }: { stored: string; initial: PromptForm; submitted?: PromptForm | null; canManage?: boolean | null } = $props();
  const seed = untrack(() => submitted ?? initial);
  const { form, errors, message, submitting, enhance, reset } = superForm(seed, {
    taintedMessage: t('agent.boot.unsaved', 'Discard your unsaved boot prompt?'),
    validators: zod4Client(bootPromptSchema), resetForm: false, clearOnSubmit: 'none',
  });
  let source = $state(untrack(() => !!submitted));
  let html = $state('');
  // Rendering is browser-only; the same sanitizer as node content runs before
  // insertion, with no prompt compilation or worker-placeholder replacement.
  $effect(() => {
    const renderer = new Marked();
    html = renderNodeMarkdown(renderer, stored);
  });
</script>

<section data-boot-prompt>
  <div class="mb-3 flex gap-1 rounded-md border border-zinc-300 p-1 dark:border-zinc-700 w-fit" aria-label={t('agent.boot.views', 'Boot prompt view')}>
    <button type="button" aria-pressed={!source} onclick={() => source = false} class="rounded px-3 py-1 text-sm {!source ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}">{t('agent.boot.rendered', 'Rendered')}</button>
    <button type="button" aria-pressed={source} onclick={() => source = true} class="rounded px-3 py-1 text-sm {source ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}">{t('agent.boot.source', 'Source')}</button>
  </div>
  <div hidden={source}>
    {#if stored}
      <div class="prose prose-sm prose-zinc max-w-none dark:prose-invert">{@html html}</div>
    {:else}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('agent.boot.empty', 'No boot prompt. Open Source to write one.')}</p>
    {/if}
  </div>
  <form hidden={!source} method="POST" action="?/updateBootPrompt" use:enhance novalidate class="space-y-3">
    <input type="hidden" name="_kind" value={$form._kind} />
    <label for="bootPromptSource" class="sr-only">{t('agent.boot.source-label', 'Boot prompt source')}</label>
    <textarea id="bootPromptSource" name="systemPrompt" bind:value={$form.systemPrompt} rows="24" readonly={canManage === false} aria-invalid={!!$errors.systemPrompt?.length} aria-describedby="bootPromptHelp" class="w-full rounded-lg border border-zinc-300 bg-white p-4 font-mono text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"></textarea>
    <p id="bootPromptHelp" class="text-xs text-zinc-500 dark:text-zinc-400">{t('agent.boot.help', 'Shared by chats and workers. Worker placeholders are kept as written here.')}</p>
    {#if $errors.systemPrompt?.length}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{$errors.systemPrompt[0]}</p>{/if}
    {#if canManage !== false}
    <div class="flex justify-end gap-2"><button type="button" disabled={$submitting} onclick={() => reset({ data: { _kind: 'bootPrompt', systemPrompt: stored } })} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">{t('agent.boot.cancel', 'Cancel')}</button><button type="submit" disabled={$submitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{$submitting ? t('agent.boot.saving', 'Saving...') : t('agent.boot.save', 'Save')}</button></div>
    {/if}
  </form>
  {#if submitted && $message}<p role={$message.type === 'error' ? 'alert' : 'status'} class="mt-3 text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$message.text}</p>{/if}
</section>
