<script lang="ts">
  import { Chat, type UIMessage } from '@ai-sdk/svelte';
  import { DefaultChatTransport } from 'ai';
  import { marked } from 'marked';
  import { t } from '$lib/i18n/t';
  import type { StationAIConfig } from '$lib/types';

  let { config, stationId, systemPrompt = '' }: { config: StationAIConfig; stationId: string; systemPrompt?: string } = $props();

  // Intentionally capture initial values — component is re-created via {#key} when these change
  const initialStationId = stationId;
  const initialSystemPrompt = systemPrompt;

  const chat = new Chat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: {
        stationId: initialStationId,
        systemPrompt: initialSystemPrompt,
      },
    }),
  });

  let inputText = $state('');

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!inputText.trim()) return;
    chat.sendMessage({ text: inputText });
    inputText = '';
  }

  function getMessageText(msg: UIMessage): string {
    return msg.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }

  function renderMarkdown(text: string): string {
    return marked.parse(text, { async: false }) as string;
  }
</script>

<div class="flex h-full flex-col">
  <!-- Messages -->
  <div class="flex-1 overflow-y-auto p-4 space-y-4">
    {#if chat.messages.length === 0}
      <div class="flex h-full items-center justify-center text-center text-sm text-zinc-400 px-4">
        Ask me anything about setting up Hadron on your machine.
      </div>
    {/if}
    {#each chat.messages as message (message.id)}
      <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[80%] rounded-lg px-4 py-2.5 text-sm
          {message.role === 'user'
            ? 'bg-amber-500 text-white'
            : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'}">
          {#if message.role === 'user'}
            <p class="whitespace-pre-wrap">{getMessageText(message)}</p>
          {:else}
            <div class="prose prose-sm dark:prose-invert max-w-none" aria-live="polite">
              {@html renderMarkdown(getMessageText(message))}
              {#if chat.status === 'streaming' && message === chat.messages[chat.messages.length - 1]}
                <span class="inline-block w-2 h-4 ml-0.5 bg-zinc-500 dark:bg-zinc-300 animate-pulse" aria-hidden="true"></span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/each}
    {#if chat.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
        {chat.error.message}
      </div>
    {/if}
  </div>

  <!-- Input -->
  <form onsubmit={handleSubmit} class="border-t border-zinc-200 p-3 dark:border-zinc-800">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={inputText}
        placeholder="Type a message..."
        disabled={chat.status === 'streaming'}
        class="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900
          placeholder-zinc-400 focus:border-indigo-500 focus:outline-none
          dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500
          disabled:opacity-50"
      />
      {#if chat.status === 'streaming'}
        <button
          type="button"
          onclick={() => chat.stop()}
          class="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600"
          aria-label={t('chat.stop', 'Stop')}
        >
          {t('chat.stop', 'Stop')}
        </button>
      {:else}
        <button
          type="submit"
          disabled={!inputText.trim()}
          class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white
            hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('chat.send', 'Send')}
        </button>
      {/if}
    </div>
  </form>
</div>
