<script lang="ts">
  import LiveOutcome from '$lib/components/LiveOutcome.svelte';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { submittedForm, failedSubmission } from '$lib/forms/submitted-form';
  import type { AppMemoryMessage } from './app-memories';
  import { createAppMemorySchema } from './schema';
  type Fields = Infer<typeof createAppMemorySchema, 'zod4'>;
  let { initial, result, hasAgent, onclose }: {
    initial: SuperValidated<Fields, AppMemoryMessage>; result: unknown;
    // The Add memory button opens this form; closing it is the user's, so a created memory's link stays in view until then.
    onclose?: () => void;
    // The App has an installed Agent (the page's app.agents). A memory is added through one, so say so before an attempt.
    hasAgent: boolean;
  } = $props();
  const { form, errors, message, submitting, enhance } = superForm(untrack(() => {
    const submitted = submittedForm<Fields>(result, 'createAppMemory') as SuperValidated<Fields, AppMemoryMessage> | null;
    return (failedSubmission<Fields>(result, 'createAppMemory') as SuperValidated<Fields, AppMemoryMessage> | null) ?? { ...initial, message: submitted?.message };
  }), {
    validators: zod4Client(createAppMemorySchema), invalidateAll: 'force', resetForm: true,
  });
  const inputClass = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
  const noAgentRefusal = $derived($message?.type === 'error' && $message.code === 'AGENT_NOT_INSTALLED');
</script>
<section class="max-w-xl" data-testid="app-memory-create" aria-labelledby="app-memory-create-title">
  <div class="flex items-center justify-between gap-3">
    <h3 id="app-memory-create-title" class="text-lg font-semibold text-zinc-900 dark:text-white">{t('app.memory.add-new', 'Add a new memory')}</h3>
    {#if onclose}<button type="button" onclick={onclose} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.memory.close', 'Close')}</button>{/if}
  </div>
  <!-- The refusal below says the same words once a submit came back AGENT_NOT_INSTALLED, so the note steps aside for it. -->
  {#if !hasAgent && !noAgentRefusal}
    <p id="app-memory-needs-agent" data-testid="app-memory-needs-agent" class="mt-3 max-w-xl text-sm text-zinc-600 dark:text-zinc-300">{t('app.memory.needs-agent', 'Install an Agent in this App before adding a memory.')}</p>
  {/if}
  <form method="POST" action="?/createMemory" use:enhance novalidate class="mt-3 max-w-xl space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <fieldset disabled={$submitting} class="space-y-3">
    <input type="hidden" name="_kind" value="createAppMemory" />
    <div>
      <label for="app-memory-name" class="mb-1 block text-sm text-zinc-900 dark:text-white">{t('app.memory.name', 'Name')}</label>
      <input id="app-memory-name" name="name" bind:value={$form.name} required class={inputClass} aria-invalid={!!$errors.name?.length} aria-describedby={$errors.name?.length ? 'app-memory-name-error' : undefined} />
      {#if $errors.name?.length}<p id="app-memory-name-error" role="alert" class="mt-1 text-sm text-red-600 dark:text-red-400">{$errors.name.join(' ')}</p>{/if}
    </div>
    <div>
      <label for="app-memory-description" class="mb-1 block text-sm text-zinc-900 dark:text-white">{t('app.memory.description', 'Description')}</label>
      <textarea id="app-memory-description" name="description" bind:value={$form.description} rows="3" class={inputClass} aria-describedby="app-memory-description-help"></textarea>
      <p id="app-memory-description-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.memory.description.help', 'Optional.')}</p>
    </div>
    <button type="submit" disabled={$submitting} aria-describedby={hasAgent || noAgentRefusal ? undefined : 'app-memory-needs-agent'} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 disabled:opacity-50">{$submitting ? t('app.memory.creating', 'Creating...') : t('app.memory.create', 'Create memory')}</button>
    </fieldset>
  </form>
  <LiveOutcome failed={$message?.type === 'error'}>
    {#if $message}
      <div class="mt-3 text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">
        <p>{$message.text}</p>
        {#if $message.type === 'success' && $message.created}
          <a href="/app/memories/{encodeURIComponent($message.created.id)}" class="mt-1 inline-block font-medium text-indigo-600 hover:underline dark:text-indigo-300">{$message.created.name}</a>
          <div class="mt-1"><Urn value={$message.created.urn} type="memory" size={10} /></div>
        {/if}
      </div>
    {/if}
  </LiveOutcome>
</section>
