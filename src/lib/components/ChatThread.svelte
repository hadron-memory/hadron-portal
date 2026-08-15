<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import Urn from '$lib/components/Urn.svelte';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { sendChatMessageSchema } from '$lib/forms/chat-message-schema';

  type SendChatMessageForm = Infer<typeof sendChatMessageSchema, 'zod4'>;
  type SendChatMessageSuperform = SuperValidated<SendChatMessageForm, App.Superforms.Message, SendChatMessageForm>;

  export type ChatThreadMessage = {
    id: string;
    author: string;
    content: string;
    createdAt: string;
    nodeData?: { loc?: string } | null;
  };

  // The message list + composer shared by the full-page chat view and the node
  // detail page's Chat tab, so a chat node reads the same either way.
  let {
    messages = [],
    basePath,
    memoryUrn = null,
    sendForm,
    form = null,
    action = '?/sendMessage',
    heightClass = 'flex-1 min-h-0',
  }: {
    messages?: ChatThreadMessage[];
    basePath: string;
    memoryUrn?: string | null;
    sendForm: SendChatMessageSuperform;
    form?: unknown;
    action?: string;
    heightClass?: string;
  } = $props();

  let messagesEl: HTMLDivElement | null = $state(null);
  let hoveredMessageId = $state<string | null>(null);
  let isBrowser = $state(false);

  const initialSendForm = untrack(
    () => (submittedForm<SendChatMessageForm>(form, 'sendChatMessage') as SendChatMessageSuperform | null) ?? sendForm,
  );
  const {
    form: sendFormData,
    errors: sendErrors,
    message: sendMessage,
    submitting: sendSubmitting,
    enhance: sendEnhance,
  } = superForm<SendChatMessageForm, App.Superforms.Message, SendChatMessageForm>(initialSendForm, {
    validators: zod4Client(sendChatMessageSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    invalidateAll: true,
    clearOnSubmit: 'none',
    resetForm: true,
  });
  const sendError = $derived(
    scopedActionError<SendChatMessageForm>(form, 'sendChatMessage', $sendMessage, $sendErrors, ['content', '_kind']),
  );

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR (invariant P4).
    // Emit nothing until mounted on the client so the {@html} sink is only
    // ever populated with sanitized HTML — never raw attacker-controlled
    // markdown during SSR or the pre-hydration client render.
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  }

  onMount(async () => {
    isBrowser = true;
    await tick();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  // Scroll to bottom after new messages arrive
  $effect(() => {
    if (messages) {
      setTimeout(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 0);
    }
  });

  // Handle keyboard submit (Ctrl+Enter or Cmd+Enter)
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  // Professional avatar colors for different senders
  function getSenderColor(index: number) {
    const colors = [
      { avatar: 'bg-slate-400 dark:bg-slate-500', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-500 dark:bg-slate-600', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-600 dark:bg-slate-700', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-700 dark:bg-slate-800', avatar_text: 'text-white dark:text-white' },
    ];
    return colors[index % colors.length];
  }

  // Track unique senders for consistent coloring
  const senderIndex: Record<string, number> = {};
  function getSenderColorClass(name: string) {
    if (!(name in senderIndex)) {
      senderIndex[name] = Object.keys(senderIndex).length;
    }
    return getSenderColor(senderIndex[name]);
  }
</script>

<div class="flex flex-col {heightClass}">
  <!-- Messages area -->
  <div
    bind:this={messagesEl}
    class="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 bg-gray-50 dark:bg-zinc-900"
  >
    {#if messages.length === 0}
      <div class="flex items-center justify-center h-full text-center">
        <div>
          <p class="text-zinc-500 dark:text-zinc-400">No messages yet</p>
          <p class="text-sm text-zinc-400 dark:text-zinc-500">Start the conversation!</p>
        </div>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        {@const color = getSenderColorClass(msg.author ?? 'Unknown')}
        {@const msgUrn = memoryUrn ? `${memoryUrn}::${msg.nodeData?.loc || ''}` : null}
        <div
          role="group"
          class="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 group"
          onmouseenter={() => (hoveredMessageId = msg.id)}
          onmouseleave={() => (hoveredMessageId = null)}
        >
          <!-- Avatar -->
          <div class="flex-shrink-0 w-8 h-8 rounded-full {color.avatar} flex items-center justify-center flex-shrink-0 mt-1">
            <span class="text-xs font-semibold {color.avatar_text}">
              {(msg.author ?? 'A').charAt(0).toUpperCase()}
            </span>
          </div>

          <!-- Message column -->
          <div class="flex-1">
            <!-- Author and URN on same row, top-aligned -->
            <div class="flex justify-between items-start gap-2 mb-1">
              <div class="text-sm font-semibold text-zinc-900 dark:text-white">
                {msg.author || 'Unknown'}
              </div>
              {#if msgUrn}
                <a
                  href="{basePath}/nodes/{msg.id}"
                  class="flex-shrink-0 transition-opacity duration-300 {hoveredMessageId === msg.id ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
                  title="Go to message node"
                >
                  <Urn value={msgUrn} type="node" />
                </a>
              {/if}
            </div>

            <!-- Bubble -->
            <div class="rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-4 py-3 text-zinc-900 dark:text-zinc-100 shadow-md">
              <div class="prose prose-sm prose-zinc max-w-none dark:prose-invert [&>*]:my-1 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>blockquote]:my-2">
                {@html renderMarkdown(msg.content)}
              </div>
            </div>

            <!-- Timestamp below bubble, right-aligned -->
            <div class="flex justify-end mt-2">
              <div class="text-xs text-zinc-500">
                {new Date(msg.createdAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Error banner -->
  {#if sendError}
    <div role="alert" class="mx-6 mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {sendError}
    </div>
  {/if}

  <!-- Input area -->
  <div class="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50 dark:bg-zinc-900">
    <form method="POST" {action} use:sendEnhance novalidate>
      <input type="hidden" name="_kind" value={$sendFormData._kind} />
      <div class="flex gap-3">
        <textarea
          name="content"
          bind:value={$sendFormData.content}
          placeholder="Type your message... (Ctrl+Enter to send)"
          rows="3"
          disabled={$sendSubmitting}
          onkeydown={handleKeydown}
          aria-invalid={!!sendError}
          class="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
        <button
          type="submit"
          disabled={!$sendFormData.content.trim() || $sendSubmitting}
          class="self-end rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {$sendSubmitting ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  </div>
</div>
