<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import type { Infer, SuperValidated } from 'sveltekit-superforms';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { ConversationEdgeDetail } from '$lib/flow/conversation-canvas';
  import { conversationStageExtractionSchema } from '$lib/flow/conversation-stage-extraction-form';
  import { t } from '$lib/i18n/t';

  type ConversationStageExtractionForm = Infer<typeof conversationStageExtractionSchema, 'zod4'>;

  // Stage side panel for the conversation canvas: prompt + extraction spec
  // (the per-stage editables) and the stage's outgoing routing rules. The
  // page keys this component by stage id, so editors seed at init.
  let {
    stage,
    extractionForm,
    extractionSaved,
    extractionError,
    rules,
    systemMemoryId,
    onClose,
    onSelectEdge,
  }: {
    stage: {
      id: string;
      loc: string;
      label: string;
      promptRef: string | null;
      promptContent: string;
      extractionSpec: unknown[];
    };
    extractionForm: SuperValidated<
      ConversationStageExtractionForm,
      App.Superforms.Message,
      ConversationStageExtractionForm
    >;
    extractionSaved: boolean;
    extractionError: string | null;
    /** Rule edges leaving this stage. */
    rules: ConversationEdgeDetail[];
    systemMemoryId: string;
    onClose: () => void;
    onSelectEdge: (edgeId: string) => void;
  } = $props();

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  let promptContent = $state(untrack(() => stage.promptContent));
  const initialExtractionForm = untrack(() => extractionForm);
  const {
    form: extractionData,
    errors: extractionErrors,
    submitting: extractionSubmitting,
    enhance: extractionEnhance,
  } = superForm<ConversationStageExtractionForm, App.Superforms.Message, ConversationStageExtractionForm>(
    initialExtractionForm,
    {
      validators: zod4Client(conversationStageExtractionSchema),
      validationMethod: 'oninput',
      scrollToError: 'smooth',
      autoFocusOnError: 'detect',
      clearOnSubmit: 'none',
    },
  );
  const extractionSpecError = $derived($extractionErrors.extractionSpec?.[0] ?? null);
</script>

<aside
  class="flex w-full shrink-0 flex-col overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 max-lg:max-h-[50%] lg:h-full lg:w-96 dark:border-zinc-800 dark:bg-zinc-900"
  aria-label={t('conversation.stagePanel.title', 'Edit stage')}
>
  <div class="mb-3 flex items-start justify-between gap-2">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">{stage.label}</h3>
      <p class="truncate font-mono text-[10px] text-zinc-400">{stage.loc}</p>
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

  {#if stage.promptRef}
    <form method="POST" action="?/updatePrompt" use:enhance class="space-y-2">
      <input type="hidden" name="systemMemoryId" value={systemMemoryId} />
      <input type="hidden" name="loc" value={stage.promptRef} />
      <label for="stagePrompt" class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('conversation.stagePanel.prompt', 'Prompt')}
      </label>
      <textarea
        id="stagePrompt"
        name="content"
        bind:value={promptContent}
        rows="10"
        class="{inputClass} font-mono text-xs"
      ></textarea>
      <p class="text-[10px] text-zinc-400">
        {t(
          'conversation.stagePanel.prompt.hint',
          'Supports Mustache: {{var}}, {{node.field}}, {{> partial}}, {{#flag}}...{{/flag}}',
        )}
      </p>
      <button
        type="submit"
        class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style="background: #fb8500;"
      >
        {t('conversation.stagePanel.prompt.save', 'Save prompt')}
      </button>
    </form>
  {:else}
    <p class="text-xs text-zinc-400">
      {t('conversation.stagePanel.prompt.none', 'This stage has no prompt reference.')}
    </p>
  {/if}

  <form
    method="POST"
    action="?/updateExtractionSpec"
    use:extractionEnhance
    class="mt-4 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
    novalidate
  >
    <input type="hidden" name="systemMemoryId" value={$extractionData.systemMemoryId} />
    <input type="hidden" name="stageLoc" value={$extractionData.stageLoc} />
    <label for="stageSpec" class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
      {t('conversation.stagePanel.extraction', 'Extraction spec')}
    </label>
    {#if extractionError}
      <div class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {extractionError}
      </div>
    {/if}
    {#if extractionSaved}
      <div class="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
        {t('conversation.stagePanel.extraction.saved', 'Extraction saved.')}
      </div>
    {/if}
    <textarea
      id="stageSpec"
      name="extractionSpec"
      bind:value={$extractionData.extractionSpec}
      rows="8"
      aria-invalid={!!extractionSpecError}
      aria-describedby={extractionSpecError ? 'stageSpecError stageSpecHint' : 'stageSpecHint'}
      class="{inputClass} font-mono text-xs {extractionSpecError ? 'border-red-500 focus:border-red-500' : ''}"
    ></textarea>
    <p id="stageSpecHint" class="text-[10px] text-zinc-400">
      {t(
        'conversation.stagePanel.extraction.hint',
        'JSON array: [{ "field": "memory.name", "description": "User name", "shape": "string" }]',
      )}
    </p>
    {#if extractionSpecError}
      <p id="stageSpecError" class="text-xs text-red-600 dark:text-red-400">{extractionSpecError}</p>
    {/if}
    <button
      type="submit"
      disabled={$extractionSubmitting}
      class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      style="background: #fb8500;"
    >
      {$extractionSubmitting
        ? t('conversation.stagePanel.extraction.saving', 'Saving...')
        : t('conversation.stagePanel.extraction.save', 'Save extraction')}
    </button>
  </form>

  <div class="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
    <h4 class="text-xs font-semibold text-zinc-900 dark:text-white">
      {t('conversation.stagePanel.rules', 'Routing rules from this stage')}
    </h4>
    {#if rules.length === 0}
      <p class="mt-1 text-xs text-zinc-400">
        {t(
          'conversation.stagePanel.rules.none',
          'None yet — drag from this stage’s right handle to another node to add one.',
        )}
      </p>
    {:else}
      <ul class="mt-2 space-y-1.5">
        {#each rules as rule (rule.id)}
          <li>
            <button
              type="button"
              onclick={() => onSelectEdge(rule.id)}
              class="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-left text-xs hover:border-indigo-300 dark:border-zinc-800 dark:hover:border-indigo-700"
            >
              <span class="font-medium text-zinc-800 dark:text-zinc-100">
                {rule.name || t('conversation.edge.unnamed', 'rule')}
              </span>
              <span class="text-zinc-400">→ {rule.targetLabel}</span>
              {#if rule.behavior === 'detour'}
                <span class="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {t('conversation.edge.detour', 'detour')}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>
