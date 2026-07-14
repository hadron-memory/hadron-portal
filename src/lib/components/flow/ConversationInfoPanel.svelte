<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';

  // Conversation side panel for the conversation canvas: goals & signals
  // (the routing surface) and the ordered stage list with add-stage. The
  // page keys this component by conversation id, so editors seed at init.
  let {
    conversation,
    systemMemoryId,
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
    systemMemoryId: string;
    onClose: () => void;
    onSelectNode: (nodeId: string) => void;
  } = $props();

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  let goalDescInput = $state(untrack(() => conversation.goalDescriptions.join('\n')));
  let goalSignalsInput = $state(untrack(() => conversation.goalSignals.join('\n')));
  let newStageName = $state('');

  const goalDescriptionsJson = $derived(
    JSON.stringify(goalDescInput.split('\n').map((s) => s.trim()).filter(Boolean)),
  );
  const goalSignalsJson = $derived(
    JSON.stringify(goalSignalsInput.split('\n').map((s) => s.trim()).filter(Boolean)),
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
    <form method="POST" action="?/updateGoals" use:enhance class="space-y-2">
      <input type="hidden" name="systemMemoryId" value={systemMemoryId} />
      <input type="hidden" name="convLoc" value={conversation.loc} />
      <div>
        <label for="convGoals" class="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('conversation.infoPanel.goals', 'Goal descriptions (one per line)')}
        </label>
        <textarea
          id="convGoals"
          bind:value={goalDescInput}
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
          bind:value={goalSignalsInput}
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
      <input type="hidden" name="goalDescriptions" value={goalDescriptionsJson} />
      <input type="hidden" name="goalSignals" value={goalSignalsJson} />
      <button
        type="submit"
        class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style="background: #fb8500;"
      >
        {t('conversation.infoPanel.goals.save', 'Save goals')}
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

    <form method="POST" action="?/addStage" use:enhance class="mt-3 flex items-end gap-2">
      <input type="hidden" name="systemMemoryId" value={systemMemoryId} />
      <input type="hidden" name="conversationLoc" value={conversation.loc} />
      <input
        type="text"
        name="stageName"
        bind:value={newStageName}
        placeholder={t('conversation.infoPanel.addStage.placeholder', 'New stage name…')}
        aria-label={t('conversation.infoPanel.addStage.placeholder', 'New stage name…')}
        class="{inputClass} text-xs"
      />
      <button
        type="submit"
        disabled={!newStageName.trim()}
        class="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {t('conversation.infoPanel.addStage', '+ Add stage')}
      </button>
    </form>
  </div>
</aside>
