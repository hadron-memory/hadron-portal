<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { conversationPromptSchema } from '$lib/flow/conversation-prompt-form';
  import { t } from '$lib/i18n/t';

  type ConversationPromptForm = Infer<typeof conversationPromptSchema, 'zod4'>;

  let {
    form,
    onCancel,
    onSaved,
  }: {
    form: SuperValidated<ConversationPromptForm, App.Superforms.Message, ConversationPromptForm>;
    onCancel: () => void;
    onSaved: () => void;
  } = $props();

  const initialForm = untrack(() => form);
  const {
    form: promptData,
    errors: promptErrors,
    message: promptMessage,
    submitting: promptSubmitting,
    enhance: promptEnhance,
  } = superForm<ConversationPromptForm, App.Superforms.Message, ConversationPromptForm>(
    initialForm,
    {
      validators: zod4Client(conversationPromptSchema),
      validationMethod: 'oninput',
      scrollToError: 'smooth',
      autoFocusOnError: 'detect',
      clearOnSubmit: 'none',
      onUpdated({ form }) {
        if (form.message?.type === 'success') onSaved();
      },
    },
  );

  const identityError = $derived(
    $promptErrors.systemMemoryId?.[0] ?? $promptErrors.loc?.[0] ?? null,
  );
  const actionError = $derived(
    $promptMessage?.type === 'error' ? $promptMessage.text : identityError,
  );
  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<form method="POST" action="?/updatePrompt" use:promptEnhance class="mt-2" novalidate>
  <input type="hidden" name="_kind" value={$promptData._kind} />
  <input type="hidden" name="systemMemoryId" value={$promptData.systemMemoryId} />
  <input type="hidden" name="loc" value={$promptData.loc} />
  {#if actionError}
    <div
      id="partialPromptError"
      role="alert"
      class="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      {actionError}
    </div>
  {/if}
  <textarea
    name="content"
    bind:value={$promptData.content}
    rows="5"
    aria-invalid={!!actionError}
    aria-describedby={actionError ? 'partialPromptError' : undefined}
    class="{inputClass} font-mono text-xs {actionError ? 'border-red-500 focus:border-red-500' : ''}"
  ></textarea>
  <div class="mt-2 flex gap-2">
    <button
      type="submit"
      disabled={$promptSubmitting}
      class="rounded px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      style="background: #fb8500;"
    >
      {$promptSubmitting
        ? t('conversation.editor.partials.saving', 'Saving...')
        : t('conversation.editor.partials.save', 'Save')}
    </button>
    <button type="button" onclick={onCancel} class="text-xs text-zinc-500">
      {t('conversation.editor.partials.cancel', 'Cancel')}
    </button>
  </div>
</form>
