<script lang="ts">
  import { Chat, type UIMessage } from '@ai-sdk/svelte';
  import { DefaultChatTransport } from 'ai';
  import { marked } from 'marked';
  import type { StationAIConfig } from '$lib/types';

  let {
    config,
    stationId,
    systemPrompt = '',
    apiEndpoint = '/api/chat',
    placeholder = 'Ask me anything about setting up Hadron on your machine.',
    uploadEndpoint = '',
    connectionId = '',
  }: {
    config: StationAIConfig;
    stationId: string;
    systemPrompt?: string;
    apiEndpoint?: string;
    placeholder?: string;
    uploadEndpoint?: string;
    connectionId?: string;
  } = $props();

  const canUpload = $derived(!!uploadEndpoint && !!connectionId);

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
  let showUploadBox = $state(false);
  let uploading = $state(false);
  let uploadError = $state('');
  let fileInputEl: HTMLInputElement | undefined = $state();
  let dragOver = $state(false);

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!inputText.trim()) return;
    // Detect upload intent and show the upload box
    if (canUpload && /\b(upload|attach|document|file)\b/i.test(inputText)) {
      showUploadBox = true;
    }
    chat.sendMessage({ text: inputText });
    inputText = '';
  }

  async function handleFileUpload(file: File) {
    if (!canUpload) return;
    uploading = true;
    uploadError = '';
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('connectionId', connectionId);
      const res = await fetch(uploadEndpoint, { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) {
        uploadError = result.error ?? 'Upload failed';
        return;
      }
      showUploadBox = false;
      // Tell the chat about the uploaded document so the AI knows
      chat.sendMessage({
        text: `I uploaded a document: "${result.document?.title ?? file.name}" (${Math.round(file.size / 1024)} KB)`,
      });
    } catch (e) {
      uploadError = e instanceof Error ? e.message : 'Upload failed';
    } finally {
      uploading = false;
    }
  }

  function onFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFileUpload(file);
    input.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) handleFileUpload(file);
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

    <!-- Upload box (shown when user asks to upload) -->
    {#if showUploadBox && canUpload}
      <div class="flex justify-start">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="w-full max-w-sm rounded-lg border-2 border-dashed p-6 text-center transition-colors
            {dragOver
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
              : 'border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/50'}"
          ondragover={(e) => { e.preventDefault(); dragOver = true; }}
          ondragleave={() => { dragOver = false; }}
          ondrop={onDrop}
        >
          {#if uploading}
            <div class="flex flex-col items-center gap-2">
              <svg class="h-6 w-6 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="4" stroke-linecap="round" class="opacity-75"/></svg>
              <span class="text-sm text-zinc-500 dark:text-zinc-400">Uploading...</span>
            </div>
          {:else}
            <svg class="mx-auto h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Drag & drop a file here, or
              <button
                type="button"
                onclick={() => fileInputEl?.click()}
                class="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
              >browse</button>
            </p>
            <p class="mt-1 text-xs text-zinc-400">.txt, .md, .csv, .html, .json</p>
          {/if}
          {#if uploadError}
            <p class="mt-2 text-xs text-red-500">{uploadError}</p>
          {/if}
          <input
            bind:this={fileInputEl}
            type="file"
            accept=".txt,.md,.csv,.html,.htm,.json"
            class="hidden"
            onchange={onFileSelected}
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- Input -->
  <form onsubmit={handleSubmit} class="border-t border-zinc-200 p-3 dark:border-zinc-800">
    <div class="flex gap-2">
      {#if canUpload}
        <button
          type="button"
          title="Upload a document"
          onclick={() => { showUploadBox = !showUploadBox; }}
          class="flex items-center justify-center rounded-lg border border-zinc-300 px-2.5 text-zinc-500
            hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400
            dark:hover:bg-zinc-800 dark:hover:text-zinc-200
            {showUploadBox ? 'bg-indigo-50 text-indigo-600 border-indigo-300 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800' : ''}"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
      {/if}
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
