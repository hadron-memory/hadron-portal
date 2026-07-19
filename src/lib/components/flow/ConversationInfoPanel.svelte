<script lang="ts">
  import { untrack } from 'svelte';
  import type { Infer, SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { addStageSchema } from '$lib/flow/conversation-add-stage-form';
  import { conversationGoalsSchema } from '$lib/flow/conversation-goals-form';
  import { t } from '$lib/i18n/t';

  type AddStageForm = Infer<typeof addStageSchema, 'zod4'>;
  type ConversationGoalsForm = Infer<typeof conversationGoalsSchema, 'zod4'>;

  // Conversation side panel for the conversation canvas: goals & signals
  // (the routing surface) and the ordered stage list with add-stage. The
  // page keys this component by conversation id, so editors seed at init.
  let {
    conversation,
    goalsForm,
    goalsSaved,
    goalsError,
    addStageForm,
    addStageSaved,
    addStageError,
    onClose,
    onSelectNode,
  }: {
    conversation: {
      id: string;
      loc: string;
      label: string;
      isSetup: boolean;
      isFallback: boolean;
      goalDescriptions: string[];
      goalSignals: string[];
      stages: Array<{ id: string; loc: string; label: string }>;
    };
    goalsForm: SuperValidated<ConversationGoalsForm, App.Superforms.Message, ConversationGoalsForm>;
    goalsSaved: string | null;
    goalsError: string | null;
    addStageForm: SuperValidated<AddStageForm, App.Superforms.Message, AddStageForm>;
    addStageSaved: string | null;
    addStageError: string | null;
    onClose: () => void;
    onSelectNode: (nodeId: string) => void;
  } = $props();

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  const initialGoalsForm = untrack(() => goalsForm);
  const {
    form: goalsData,
    errors: goalsErrors,
    submitting: goalsSubmitting,
    enhance: goalsEnhance,
  } = superForm<ConversationGoalsForm, App.Superforms.Message, ConversationGoalsForm>(
    initialGoalsForm,
    {
      validators: zod4Client(conversationGoalsSchema),
      validationMethod: 'oninput',
      scrollToError: 'smooth',
      autoFocusOnError: 'detect',
      clearOnSubmit: 'none',
    },
  );
  const identityError = $derived(
    $goalsErrors.systemMemoryId?.[0] ?? $goalsErrors.convLoc?.[0] ?? null,
  );
  const initialAddStageForm = untrack(() => addStageForm);
  const {
    form: addStageData,
    errors: addStageErrors,
    submitting: addStageSubmitting,
    enhance: addStageEnhance,
  } = superForm<AddStageForm, App.Superforms.Message, AddStageForm>(
    initialAddStageForm,
    {
      validators: zod4Client(addStageSchema),
      validationMethod: 'oninput',
      scrollToError: 'smooth',
      autoFocusOnError: 'detect',
      clearOnSubmit: 'none',
      resetForm: true,
    },
  );
  const addStageIdentityError = $derived(
    $addStageErrors.systemMemoryId?.[0] ?? $addStageErrors.conversationLoc?.[0] ?? null,
  );
</script>

<aside
  class="flex w-full shrink-0 flex-col overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 max-lg:max-h-[50%] lg:h-full lg:w-96 dark:border-zinc-800 dark:bg-zinc-900"
  aria-label={t('conversation.infoPanel.title', 'Edit conversation')}
>
  <div class="mb-3 flex items-start justify-between gap-2">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">{conversation.label}</h3>
      <p class="truncate font-mono text-[10px] text-zinc-400">{conversation.loc}</p>
      <div class="mt-1 flex gap-1">
        {#if conversation.isSetup}
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            {t('conversation.card.setup', 'setup')}
          </span>
        {/if}
        {#if conversation.isFallback}
          <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {t('conversation.card.fallback', 'fallback')}
          </span>
        {/if}
      </div>
    </div>
    <button
      type="button"
      onclick={onClose}
      aria-label={t('conversation.panel.close', 'Close panel')}
      class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      ✕
    </button>
  </div>

  {#if !conversation.isSetup && !conversation.isFallback}
    <form method="POST" action="?/updateGoals" use:goalsEnhance class="space-y-2" novalidate>
      <input type="hidden" name="systemMemoryId" value={$goalsData.systemMemoryId} />
      <input type="hidden" name="convLoc" value={$goalsData.convLoc} />
      {#if goalsError || identityError}
        <div
          role="alert"
          class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {goalsError ?? identityError}
        </div>
      {/if}
      {#if goalsSaved}
        <div
          role="status"
          class="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
        >
          {goalsSaved}
        </div>
      {/if}
      <div>
        <label for="convGoals" class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('conversation.infoPanel.goals', 'Goal descriptions (one per line)')}
        </label>
        <textarea
          id="convGoals"
          name="goalDescriptionsText"
          bind:value={$goalsData.goalDescriptionsText}
          rows="3"
          placeholder={t(
            'conversation.infoPanel.goals.placeholder',
            'Help the user find a mentor\nAnswer questions about mentorship',
          )}
          class="{inputClass} mt-1 text-xs"
        ></textarea>
        <p class="text-[10px] text-zinc-400">
          {t(
            'conversation.infoPanel.goals.hint',
            'Describe when this conversation is the right fit. Multiple phrasings improve routing.',
          )}
        </p>
      </div>
      <div>
        <label for="convSignals" class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('conversation.infoPanel.signals', 'Goal signals (one per line)')}
        </label>
        <textarea
          id="convSignals"
          name="goalSignalsText"
          bind:value={$goalsData.goalSignalsText}
          rows="3"
          placeholder={t(
            'conversation.infoPanel.signals.placeholder',
            'I need a mentor\nFind someone to help me',
          )}
          class="{inputClass} mt-1 text-xs"
        ></textarea>
        <p class="text-[10px] text-zinc-400">
          {t(
            'conversation.infoPanel.signals.hint',
            'Example user statements that should route here. This list grows from real usage.',
          )}
        </p>
      </div>
      <button
        type="submit"
        disabled={$goalsSubmitting}
        class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        style="background: #fb8500;"
      >
        {$goalsSubmitting
          ? t('conversation.infoPanel.goals.saving', 'Saving...')
          : t('conversation.infoPanel.goals.save', 'Save goals')}
      </button>
    </form>
  {/if}

  <div class="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
    <h4 class="text-xs font-semibold text-zinc-900 dark:text-white">
      {t('conversation.infoPanel.stages', 'Stages (in order)')}
    </h4>
    {#if conversation.stages.length === 0}
      <p class="mt-1 text-xs text-zinc-400">
        {t('conversation.infoPanel.stages.none', 'No stages yet.')}
      </p>
    {:else}
      <ol class="mt-2 space-y-1.5">
        {#each conversation.stages as stage, i (stage.id)}
          <li>
            <button
              type="button"
              onclick={() => onSelectNode(stage.id)}
              class="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-left text-xs hover:border-indigo-300 dark:border-zinc-800 dark:hover:border-indigo-700"
            >
              <span class="font-mono text-zinc-400">{i + 1}.</span>
              <span class="font-medium text-zinc-800 dark:text-zinc-100">{stage.label}</span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}

    <form method="POST" action="?/addStage" use:addStageEnhance class="mt-3 space-y-2" novalidate>
      <input type="hidden" name="systemMemoryId" value={$addStageData.systemMemoryId} />
      <input type="hidden" name="conversationLoc" value={$addStageData.conversationLoc} />
      {#if addStageError || addStageIdentityError}
        <div
          role="alert"
          class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {addStageError ?? addStageIdentityError}
        </div>
      {/if}
      {#if addStageSaved}
        <div
          role="status"
          class="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
        >
          {addStageSaved}
        </div>
      {/if}
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <input
            type="text"
            name="stageName"
            bind:value={$addStageData.stageName}
            placeholder={t('conversation.infoPanel.addStage.placeholder', 'New stage name…')}
            aria-label={t('conversation.infoPanel.addStage.placeholder', 'New stage name…')}
            aria-invalid={$addStageErrors.stageName?.[0] ? 'true' : undefined}
            aria-describedby={$addStageErrors.stageName?.[0] ? 'add-stage-name-error' : undefined}
            class="{inputClass} text-xs"
          />
          {#if $addStageErrors.stageName?.[0]}
            <p id="add-stage-name-error" class="mt-1 text-xs text-red-600 dark:text-red-400">
              {$addStageErrors.stageName[0]}
            </p>
          {/if}
        </div>
        <button
          type="submit"
          disabled={!$addStageData.stageName.trim() || $addStageSubmitting}
          class="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {$addStageSubmitting
            ? t('conversation.infoPanel.addStage.saving', 'Adding...')
            : t('conversation.infoPanel.addStage', '+ Add stage')}
        </button>
      </div>
    </form>
  </div>
</aside>
