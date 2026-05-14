<script lang="ts">
  import { t } from '$lib/i18n/t';

  type AssertionMode = 'none' | 'literal-contains' | 'regex' | 'llm-judge';

  type AssertionPayload =
    | { mode: 'literal-contains'; value: string }
    | { mode: 'regex'; pattern: string; flags: string }
    | { mode: 'llm-judge'; criterion: string; threshold: number }
    | null;

  let {
    onrun,
    running = false,
  }: {
    onrun: (payload: {
      message: string;
      persona: string | null;
      resetSession: boolean;
      assertion: AssertionPayload;
    }) => void;
    running?: boolean;
  } = $props();

  let message = $state('');
  let persona = $state('');
  let resetOnNext = $state(false);

  let assertionMode = $state<AssertionMode>('none');
  // mode-specific inputs (kept independent so switching modes doesn't lose state)
  let literalValue = $state('');
  let regexPattern = $state('');
  let regexFlags = $state('');
  let judgeCriterion = $state('');
  let judgeThreshold = $state(0.7);
  let clientError = $state<string | null>(null);

  function buildAssertion(): AssertionPayload {
    switch (assertionMode) {
      case 'none':
        return null;
      case 'literal-contains':
        return { mode: 'literal-contains', value: literalValue };
      case 'regex':
        return { mode: 'regex', pattern: regexPattern, flags: regexFlags };
      case 'llm-judge':
        return { mode: 'llm-judge', criterion: judgeCriterion, threshold: judgeThreshold };
    }
  }

  function validate(): string | null {
    if (assertionMode === 'literal-contains' && !literalValue.trim()) {
      return t('agent-tester.assert.error.literal-empty', 'Literal value cannot be empty');
    }
    if (assertionMode === 'regex') {
      if (!regexPattern.trim()) return t('agent-tester.assert.error.regex-empty', 'Regex pattern cannot be empty');
      try { new RegExp(regexPattern, regexFlags); }
      catch (e) {
        return t('agent-tester.assert.error.regex-invalid', `Invalid regex: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
    if (assertionMode === 'llm-judge') {
      if (!judgeCriterion.trim()) return t('agent-tester.assert.error.judge-empty', 'Criterion cannot be empty');
      if (judgeThreshold < 0 || judgeThreshold > 1) return t('agent-tester.assert.error.judge-range', 'Threshold must be between 0 and 1');
    }
    return null;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || running) return;
    const err = validate();
    if (err) {
      clientError = err;
      return;
    }
    clientError = null;
    onrun({
      message: trimmed,
      persona: persona.trim() || null,
      resetSession: resetOnNext,
      assertion: buildAssertion(),
    });
    resetOnNext = false;
  }
</script>

<form onsubmit={submit} class="space-y-3">
  <div>
    <label for="probe-message" class="block text-sm font-medium text-zinc-700 dark:text-zinc-200">
      {t('agent-tester.probe.message-label', 'Test message')}
    </label>
    <textarea
      id="probe-message"
      bind:value={message}
      rows="3"
      placeholder={t('agent-tester.probe.message-placeholder', 'Type a message to send to the chatbot…')}
      class="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      disabled={running}
    ></textarea>
  </div>

  <div>
    <label for="probe-persona" class="block text-sm font-medium text-zinc-700 dark:text-zinc-200">
      {t('agent-tester.probe.persona-label', 'Persona (optional)')}
    </label>
    <input
      id="probe-persona"
      type="text"
      bind:value={persona}
      placeholder={t('agent-tester.probe.persona-placeholder', 'Leave empty for default routing')}
      class="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      disabled={running}
    />
  </div>

  <fieldset class="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
    <legend class="px-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
      {t('agent-tester.assert.heading', 'Assertion (optional)')}
    </legend>
    <div class="space-y-2">
      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
        <input type="radio" name="assertion-mode" bind:group={assertionMode} value="none" disabled={running} />
        {t('agent-tester.assert.mode-none', 'None (probe only)')}
      </label>
      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
        <input type="radio" name="assertion-mode" bind:group={assertionMode} value="literal-contains" disabled={running} />
        {t('agent-tester.assert.mode-literal', 'Literal contains')}
      </label>
      {#if assertionMode === 'literal-contains'}
        <input
          type="text"
          bind:value={literalValue}
          placeholder={t('agent-tester.assert.literal-placeholder', 'Substring the reply must contain')}
          class="ml-5 w-[calc(100%-1.25rem)] rounded-md border border-zinc-300 px-3 py-1.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          disabled={running}
        />
      {/if}
      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
        <input type="radio" name="assertion-mode" bind:group={assertionMode} value="regex" disabled={running} />
        {t('agent-tester.assert.mode-regex', 'Regex')}
      </label>
      {#if assertionMode === 'regex'}
        <div class="ml-5 flex gap-2">
          <input
            type="text"
            bind:value={regexPattern}
            placeholder={t('agent-tester.assert.regex-placeholder', 'Pattern, e.g. ^Hello')}
            class="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-mono shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            disabled={running}
          />
          <input
            type="text"
            bind:value={regexFlags}
            placeholder={t('agent-tester.assert.regex-flags-placeholder', 'flags')}
            class="w-20 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-mono shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            disabled={running}
          />
        </div>
      {/if}
      <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
        <input type="radio" name="assertion-mode" bind:group={assertionMode} value="llm-judge" disabled={running} />
        {t('agent-tester.assert.mode-judge', 'LLM-judge')}
      </label>
      {#if assertionMode === 'llm-judge'}
        <div class="ml-5 space-y-2">
          <input
            type="text"
            bind:value={judgeCriterion}
            placeholder={t('agent-tester.assert.judge-criterion-placeholder', 'Criterion, e.g. "Reply is welcoming."')}
            class="block w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            disabled={running}
          />
          <label class="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('agent-tester.assert.judge-threshold', 'Threshold')}:
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              bind:value={judgeThreshold}
              class="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              disabled={running}
            />
          </label>
        </div>
      {/if}
    </div>
  </fieldset>

  {#if clientError}
    <p class="text-xs text-red-600 dark:text-red-400">{clientError}</p>
  {/if}

  <div class="flex items-center gap-2">
    <button
      type="submit"
      disabled={!message.trim() || running}
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
    >
      {running ? t('agent-tester.probe.running', 'Running…') : t('agent-tester.probe.run', 'Run')}
    </button>
    <button
      type="button"
      onclick={() => { resetOnNext = true; message = ''; persona = ''; }}
      class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      disabled={running}
    >
      {t('agent-tester.probe.reset-session', 'Reset session')}
    </button>
    {#if resetOnNext}
      <span class="text-xs text-zinc-500 dark:text-zinc-400">
        {t('agent-tester.probe.reset-flagged', 'Next run will start fresh')}
      </span>
    {/if}
  </div>
</form>
