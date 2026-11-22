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
  let { initial, result, hasAgent }: {
    initial: SuperValidated<Fields, AppMemoryMessage>; result: unknown;
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
  // Closed until asked for, but a submission that came back (an error to fix, or the link to what was created) must stay in view.
  let open = $state(untrack(() => $message !== undefined || ($errors.name?.length ?? 0) > 0));
</script>
<details bind:open class="group max-w-xl" data-testid="app-memory-create">
  <summary class="flex cursor-pointer list-none items-center gap-2 text-lg font-semibold text-zinc-900 hover:text-zinc-700 dark:text-white dark:hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
    <svg class="h-5 w-5 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
    {t('app.memory.add', 'Add a memory')}
  </summary>
  {#if !hasAgent}
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
      <p id="app-memory-description-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.memory.description.help', 'Optional. Shown in the list of App memories.')}</p>
    </div>
    <button type="submit" disabled={$submitting} aria-describedby={hasAgent ? undefined : 'app-memory-needs-agent'} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 disabled:opacity-50">{$submitting ? t('app.memory.creating', 'Creating...') : t('app.memory.create', 'Create memory')}</button>
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
</details>
