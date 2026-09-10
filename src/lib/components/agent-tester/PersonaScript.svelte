<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';
  import { t } from '$lib/i18n/t';

  let { agentId }: { agentId: string } = $props();

  let personaName = $state('');
  let openingMessage = $state('');
  // followUps as a flexible string[] — empty entries are stripped at submit.
  let followUps = $state<string[]>(['']);
  let conversationName = $state(''); // optional starting conversation override
  let expectedConversations = $state(''); // comma-separated user input
  let collapsed = $state(true);

  interface ScriptTurn {
    step: number;
    role: 'user' | 'assistant';
    message: string;
    stageTransitioned?: boolean;
    newStageName?: string | null;
    conversationHandoff?: string | null;
    onTrack?: boolean;
  }

  interface ScriptResult {
    chatId: string;
    personaName: string;
    pass: boolean;
    issues: string[];
    turns: ScriptTurn[];
    stageTransitions: Array<{ step: number; newStage: string | null; conversationHandoff: string | null }>;
    conversationsVisited: string[];
    totalTurns: number;
  }

  let result = $state<ScriptResult | null>(null);
  let running = $state(false);
  let errorText = $state<string | null>(null);

  function addFollowUp() {
    followUps = [...followUps, ''];
  }

  function removeFollowUp(i: number) {
    followUps = followUps.filter((_, idx) => idx !== i);
    if (followUps.length === 0) followUps = [''];
  }

  function renderMessageHtml(msg: string): string {
    const raw = String(marked.parse(msg));
    return DOMPurify.sanitize(raw);
  }

  async function runScript(e: SubmitEvent) {
    e.preventDefault();
    if (running) return;
    if (!personaName.trim() || !openingMessage.trim()) {
      errorText = t('agent-tester.persona.error.required', 'Persona name and opening message are required.');
      return;
    }
    running = true;
    errorText = null;
    result = null;
    try {
      const trimmedFollowUps = followUps.map((f) => f.trim()).filter((f) => f);
      const expected = expectedConversations
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s);
      const res = await fetch('/api/agent-chat/test-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          personaName: personaName.trim(),
          openingMessage: openingMessage.trim(),
          followUpMessages: trimmedFollowUps,
          conversationName: conversationName.trim() || undefined,
          expectedConversations: expected,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Script run failed' }));
        errorText = body.error ?? 'Script run failed';
        return;
      }
      result = (await res.json()) as ScriptResult;
    } catch (e2) {
      errorText = e2 instanceof Error ? e2.message : 'Script run failed';
    } finally {
      running = false;
    }
  }
</script>

<section class="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
  <button
    type="button"
    onclick={() => (collapsed = !collapsed)}
    class="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-zinc-900 hover:bg-zinc-50 dark:text-white dark:hover:bg-zinc-800"
  >
    <span>{t('agent-tester.persona.heading', 'Scripted persona (multi-turn)')}</span>
    <span class="text-zinc-400">{collapsed ? '▸' : '▾'}</span>
  </button>

  {#if !collapsed}
    <div class="space-y-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p class="text-xs text-zinc-500 dark:text-zinc-400">
        {t('agent-tester.persona.subhead', 'Run a scripted multi-turn conversation. The bot replies after each user message; the next message in your script is sent in turn until the script ends or the bot ends the chat.')}
      </p>

      <form onsubmit={runScript} class="space-y-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label for="ps-persona" class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {t('agent-tester.persona.persona-label', 'Persona name')}
            </label>
            <input
              id="ps-persona"
              type="text"
              bind:value={personaName}
              placeholder={t('agent-tester.persona.persona-placeholder', 'e.g. curious-user')}
              class="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              disabled={running}
            />
          </div>
          <div>
            <label for="ps-conv" class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {t('agent-tester.persona.conversation-label', 'Start conversation (optional)')}
            </label>
            <input
              id="ps-conv"
              type="text"
              bind:value={conversationName}
              placeholder={t('agent-tester.persona.conversation-placeholder', 'e.g. conversations:setup')}
              class="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-mono shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              disabled={running}
            />
          </div>
        </div>

        <div>
          <label for="ps-opening" class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {t('agent-tester.persona.opening-label', 'Opening message')}
          </label>
          <textarea
            id="ps-opening"
            bind:value={openingMessage}
            rows="2"
            placeholder={t('agent-tester.persona.opening-placeholder', 'First user message the persona sends')}
            class="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            disabled={running}
          ></textarea>
        </div>

        <div>
          <div id="ps-followups-label" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {t('agent-tester.persona.followups-label', 'Follow-up messages')}
          </div>
          <div class="space-y-2" aria-labelledby="ps-followups-label">
            {#each followUps as _f, i (i)}
              <div class="flex items-start gap-2">
                <span class="mt-2 w-6 text-right text-xs text-zinc-400">{i + 1}.</span>
                <textarea
                  aria-label={t('agent-tester.persona.followup-numbered-label', 'Follow-up message {number}', { number: i + 1 })}
                  bind:value={followUps[i]}
                  rows="2"
                  placeholder={t('agent-tester.persona.followup-placeholder', 'Next user message')}
                  class="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                  disabled={running}
                ></textarea>
                <button
                  type="button"
                  onclick={() => removeFollowUp(i)}
                  class="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  disabled={running}
                >
                  ✕
                </button>
              </div>
            {/each}
          </div>
          <button
            type="button"
            onclick={addFollowUp}
            class="mt-2 rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            disabled={running}
          >
            + {t('agent-tester.persona.add-followup', 'Add follow-up')}
          </button>
        </div>

        <div>
          <label for="ps-expected" class="block text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {t('agent-tester.persona.expected-label', 'Expected conversations (optional, comma-separated)')}
          </label>
          <input
            id="ps-expected"
            type="text"
            bind:value={expectedConversations}
            placeholder={t('agent-tester.persona.expected-placeholder', 'e.g. conversations:setup, conversations:fallback')}
            class="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-mono shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            disabled={running}
          />
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t('agent-tester.persona.expected-help', 'If set, the run passes only when every named conversation is visited at least once.')}
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="submit"
            disabled={!personaName.trim() || !openingMessage.trim() || running}
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            {running ? t('agent-tester.persona.running', 'Running script…') : t('agent-tester.persona.run', 'Run script')}
          </button>
          {#if result}
            <span class="text-xs text-zinc-500 dark:text-zinc-400">
              {t('agent-tester.persona.totals', 'Total turns')}: {result.totalTurns}
            </span>
          {/if}
        </div>
      </form>

      {#if errorText}
        <p class="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {errorText}
        </p>
      {/if}

      {#if result}
        <!-- Pass/fail summary -->
        <div
          class="rounded-md border p-3 text-sm {result.pass
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950'
            : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950'}"
        >
          <div class="flex items-center gap-2">
            <span
              class="rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide {result.pass
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white'}"
            >
              {result.pass ? t('agent-tester.verdict.pass', 'Pass') : t('agent-tester.verdict.fail', 'Fail')}
            </span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">
              {t('agent-tester.persona.visited', 'Conversations visited')}: {result.conversationsVisited.join(', ') || '—'}
            </span>
          </div>
          {#if result.issues.length}
            <ul class="mt-2 list-disc pl-5 text-xs text-zinc-700 dark:text-zinc-300">
              {#each result.issues as issue, i (i)}
                <li>{issue}</li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Transcript -->
        <ol class="space-y-2">
          {#each result.turns as turn, i (i)}
            <li
              class="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800 {turn.role === 'user'
                ? 'bg-indigo-50 dark:bg-indigo-950'
                : 'bg-white dark:bg-zinc-900'}"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {turn.role === 'user'
                    ? t('agent-tester.persona.turn-user', 'User')
                    : t('agent-tester.persona.turn-assistant', 'Assistant')}
                  · step {turn.step}
                </span>
                {#if turn.stageTransitioned}
                  <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                    → {turn.newStageName ?? '?'}{turn.conversationHandoff ? ` (${turn.conversationHandoff})` : ''}
                  </span>
                {/if}
                {#if turn.onTrack === false}
                  <span class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                    {t('agent-tester.persona.off-track', 'off-track')}
                  </span>
                {/if}
              </div>
              <div class="prose prose-sm max-w-none dark:prose-invert">
                {@html renderMessageHtml(turn.message)}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</section>
