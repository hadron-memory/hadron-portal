<script lang="ts">
  import { Chat, type UIMessage } from '@ai-sdk/svelte';
  import { DefaultChatTransport } from 'ai';
  import { marked } from 'marked';
  import type { StationAIConfig } from '$lib/types';

  let { config, stationId, systemPrompt = '', apiEndpoint = '/api/chat', placeholder = 'Ask me anything about setting up Hadron on your machine.' }: { config: StationAIConfig; stationId: string; systemPrompt?: string; apiEndpoint?: string; placeholder?: string } = $props();

  // Intentionally capture initial values — component is re-created via {#key} when these change
  const initialStationId = stationId;
  const initialSystemPrompt = systemPrompt;

  const chat = new Chat({
    transport: new DefaultChatTransport({
      api: apiEndpoint,
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

  /** Check if a part is a tool call (type starts with 'tool-' but isn't 'text') */
  function isToolPart(p: { type: string }): boolean {
    return p.type.startsWith('tool-') || p.type === 'dynamic-tool';
  }

  function getToolLabels(msg: UIMessage): string[] {
    return msg.parts
      .filter((p) => isToolPart(p))
      .map((p) => {
        if (p.type === 'dynamic-tool') return (p as { toolName?: string }).toolName ?? 'tool';
        // type is 'tool-{name}', extract the name
        return p.type.replace(/^tool-/, '').replace(/_/g, ' ');
      });
  }

  function hasText(msg: UIMessage): boolean {
    return getMessageText(msg).length > 0;
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
        {placeholder}
      </div>
    {/if}
    {#each chat.messages as message (message.id)}
      {#if message.role === 'user'}
        <div class="flex justify-end">
          <div class="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-indigo-600 text-white">
            <p class="whitespace-pre-wrap">{getMessageText(message)}</p>
          </div>
        </div>
      {:else}
        <!-- Show tool activity labels if any -->
        {#if getToolLabels(message).length > 0}
          <div class="flex justify-start">
            <div class="flex flex-wrap gap-1.5 px-1">
              {#each getToolLabels(message) as toolLabel}
                <span class="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-600 ring-1 ring-indigo-500/20 dark:text-indigo-400">
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {toolLabel}
                </span>
              {/each}
            </div>
          </div>
        {/if}
        <!-- Show text content if any -->
        {#if hasText(message)}
          <div class="flex justify-start">
            <div class="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
              <div class="prose prose-sm dark:prose-invert max-w-none">
                {@html renderMarkdown(getMessageText(message))}
              </div>
            </div>
          </div>
        {/if}
      {/if}
    {/each}
    {#if chat.status === 'streaming'}
      <div class="flex justify-start">
        <div class="rounded-lg bg-zinc-100 px-4 py-2.5 text-sm text-zinc-500 dark:bg-zinc-800">
          <span class="animate-pulse">Thinking...</span>
        </div>
      </div>
    {/if}
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
      <button
        type="submit"
        disabled={chat.status === 'streaming' || !inputText.trim()}
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white
          hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Send
      </button>
    </div>
  </form>
</div>
