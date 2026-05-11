<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import type { Chat, ChatMessage } from '$lib/types';
  import AssetUploadButton from '$lib/components/assets/AssetUploadButton.svelte';
  import AssetChip from '$lib/components/assets/AssetChip.svelte';
  import type { AssetSummary } from '$lib/api/assetUpload';
  import { resolveActiveChatFromUrl } from '$lib/components/agent-chat-helpers.js';
  import { t } from '$lib/i18n/t.js';

  function renderMarkdown(text: string): string {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }

  // v2 (spec 006-asset-upload-redesign): memoryId replaces agentUrn for
  // asset uploads. The parent page picks the destination memory (for now,
  // the agent's first writable memory). Multi-writable memory-picker UX
  // is a follow-up; the dominant single-writable case auto-picks.
  let { agentId, uploadMemoryId }: { agentId: string; uploadMemoryId?: string } = $props();

  let pendingAttachments = $state<AssetSummary[]>([]);

  function onAssetUploaded(asset: AssetSummary) {
    pendingAttachments = [...pendingAttachments, asset];
  }
  function removeAttachment(id: string) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
  }

  // ── State ─────────────────────────────────────────────────────────────
  let chats = $state<Chat[]>([]);
  let loadingList = $state(true);
  let listError = $state<string | null>(null);

  let activeChatId = $state<string | null>(null);
  let activeChatMeta = $state<{
    title: string;
    conversationName: string | null;
    stageName: string | null;
  } | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let loadingChat = $state(false);

  let input = $state('');
  let sending = $state(false);
  let turnError = $state<string | null>(null);

  // Inline rename state
  let renamingChatId = $state<string | null>(null);
  let renameValue = $state('');

  // Delete confirm state
  let pendingDeleteChatId = $state<string | null>(null);

  // Recent stage-transition toast
  let stageToast = $state<{ from: string; to: string } | null>(null);

  // Spec 016 — welcome turn is best-effort; surface its failure as a
  // soft hint rather than blocking the chat. Cleared on first send.
  let welcomeNotice = $state<string | null>(null);

  let messagesEl: HTMLDivElement | null = $state(null);

  // ── Initial list fetch ───────────────────────────────────────────────
  // After loading the chat list, auto-resume the chat referenced by
  // `?chat=<id>` so a reload restores the open conversation. Without
  // this, every reload silently emptied the transcript pane — to the
  // user that looked like "chats are not saving."
  onMount(async () => {
    await refreshChatList();
    const target = resolveActiveChatFromUrl(new URL(window.location.href), chats);
    if (target) {
      await resumeChat(target);
    } else if (new URL(window.location.href).searchParams.has('chat')) {
      // Stale ?chat=<id> (e.g. chat deleted in another tab) — clear it.
      syncChatIdToUrl(null);
    }
  });

  /**
   * Sync the active chat id into the URL as a query param so a reload
   * (or shared link) restores the same chat. Uses replaceState to keep
   * the back button clean — picking another chat is not navigation.
   */
  function syncChatIdToUrl(chatId: string | null): void {
    const url = new URL(window.location.href);
    if (chatId) {
      if (url.searchParams.get('chat') === chatId) return;
      url.searchParams.set('chat', chatId);
    } else {
      if (!url.searchParams.has('chat')) return;
      url.searchParams.delete('chat');
    }
    goto(url.pathname + url.search + url.hash, {
      keepFocus: true,
      replaceState: true,
      noScroll: true,
    });
  }

  async function refreshChatList() {
    loadingList = true;
    listError = null;
    try {
      const res = await fetch(`/api/agent-chat/list?agentId=${encodeURIComponent(agentId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to load chats');
      chats = body.chats ?? [];
    } catch (e) {
      listError = e instanceof Error ? e.message : 'Failed to load chats';
    } finally {
      loadingList = false;
    }
  }

  // ── Starting / resuming chats ────────────────────────────────────────
  async function startNewChat() {
    loadingChat = true;
    turnError = null;
    messages = [];
    activeChatId = null;
    activeChatMeta = null;
    try {
      const res = await fetch('/api/agent-chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to start chat');
      activeChatId = body.chatId;
      syncChatIdToUrl(activeChatId);
      activeChatMeta = {
        title: t('agent-chat.new-chat-title', 'New chat'),
        conversationName: body.conversationName,
        stageName: body.stageName,
      };
      // Spec 016 — welcome turn is best-effort. Only render the
      // welcome bubble when the server actually produced one; on
      // welcomeError, surface a soft hint and leave the transcript
      // empty so the user can type the first message themselves.
      messages = body.welcomeMessage
        ? [
            {
              role: 'assistant',
              content: body.welcomeMessage,
              seq: 0,
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
      welcomeNotice = body.welcomeError
        ? t(
            'agent-chat.welcome-error-hint',
            "Couldn't generate a welcome message — type below to start the chat. (Underlying error: ",
          ) + body.welcomeError + ')'
        : null;
      await refreshChatList();
      scrollMessagesToBottom();
    } catch (e) {
      turnError = e instanceof Error ? e.message : 'Failed to start chat';
    } finally {
      loadingChat = false;
    }
  }

  async function resumeChat(chatId: string) {
    if (activeChatId === chatId) return;
    loadingChat = true;
    turnError = null;
    welcomeNotice = null;
    messages = [];
    activeChatId = chatId;
    syncChatIdToUrl(chatId);
    activeChatMeta = null;
    try {
      const res = await fetch('/api/agent-chat/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, chatId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to resume chat');
      activeChatMeta = {
        title: body.chat.title,
        conversationName: body.chat.conversationName,
        stageName: body.chat.stageName,
      };
      messages = body.messages ?? [];
      scrollMessagesToBottom();
    } catch (e) {
      turnError = e instanceof Error ? e.message : 'Failed to resume chat';
      activeChatId = null;
      syncChatIdToUrl(null);
    } finally {
      loadingChat = false;
    }
  }

  // ── Sending a message ────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim();
    if (!text || !activeChatId || sending) return;
    const chatId = activeChatId;
    input = '';
    sending = true;
    turnError = null;
    welcomeNotice = null;

    // Optimistic user bubble
    messages = [
      ...messages,
      {
        role: 'user',
        content: text,
        seq: messages.length,
        createdAt: new Date().toISOString(),
      },
    ];
    scrollMessagesToBottom();

    try {
      const res = await fetch('/api/agent-chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, chatId, userMessage: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Turn failed');

      // Assistant bubble
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: body.assistantMessage ?? '',
          seq: messages.length,
          createdAt: new Date().toISOString(),
        },
      ];
      scrollMessagesToBottom();

      if (body.stageTransitioned && body.newStageName && activeChatMeta) {
        const from = activeChatMeta.stageName ?? '';
        const toLabel = body.conversationHandoff
          ? `${body.conversationHandoff}/${body.newStageName}`
          : body.newStageName;
        activeChatMeta = { ...activeChatMeta, stageName: body.newStageName };
        if (body.conversationHandoff) {
          activeChatMeta = { ...activeChatMeta, conversationName: body.conversationHandoff };
        }
        stageToast = { from, to: toLabel };
        setTimeout(() => {
          if (stageToast?.from === from && stageToast?.to === toLabel) {
            stageToast = null;
          }
        }, 4000);
      }

      // Refresh the list so lastMessageAt + derived title update
      refreshChatList();
    } catch (e) {
      turnError = e instanceof Error ? e.message : 'Turn failed';
      // Rollback the optimistic user bubble
      messages = messages.slice(0, -1);
      input = text;
    } finally {
      sending = false;
    }
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function scrollMessagesToBottom() {
    await tick();
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ── Rename + delete ──────────────────────────────────────────────────
  function startRename(chat: Chat) {
    renamingChatId = chat.loc;
    renameValue = chat.title;
  }
  async function commitRename(chatId: string) {
    const title = renameValue.trim();
    renamingChatId = null;
    if (!title) return;
    try {
      const res = await fetch('/api/agent-chat/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, title }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(body.error ?? 'Failed');
      }
      if (activeChatId === chatId && activeChatMeta) {
        activeChatMeta = { ...activeChatMeta, title };
      }
      await refreshChatList();
    } catch (e) {
      turnError = e instanceof Error ? e.message : 'Rename failed';
    }
  }
  function cancelRename() {
    renamingChatId = null;
    renameValue = '';
  }

  async function confirmDelete(chatId: string) {
    pendingDeleteChatId = null;
    try {
      const res = await fetch('/api/agent-chat/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(body.error ?? 'Failed');
      }
      if (activeChatId === chatId) {
        activeChatId = null;
        syncChatIdToUrl(null);
        activeChatMeta = null;
        messages = [];
        welcomeNotice = null;
      }
      await refreshChatList();
    } catch (e) {
      turnError = e instanceof Error ? e.message : 'Delete failed';
    }
  }

  function formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString();
  }
</script>

<!-- Full-height layout: left chat list + right active chat.
     The parent container gives us all available vertical space. -->
<div class="flex h-full min-h-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
  <!-- ── Chat list sidebar ───────────────────────────────────────────── -->
  <aside class="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
    <div class="border-b border-zinc-200 p-3 dark:border-zinc-800">
      <button
        type="button"
        onclick={startNewChat}
        class="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style="background: #fb8500;"
        disabled={loadingChat}
      >
        + New chat
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if loadingList && chats.length === 0}
        <p class="p-3 text-xs text-zinc-500">Loading chats…</p>
      {:else if listError}
        <p class="p-3 text-xs text-red-500">{listError}</p>
      {:else if chats.length === 0}
        <p class="p-3 text-xs text-zinc-500">No chats yet. Start a new one above.</p>
      {:else}
        <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
          {#each chats as chat (chat.loc)}
            <li class="group relative">
              {#if renamingChatId === chat.loc}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  type="text"
                  bind:value={renameValue}
                  onblur={() => commitRename(chat.loc)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  autofocus
                  class="w-full border-0 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-white"
                />
              {:else}
                <button
                  type="button"
                  onclick={() => resumeChat(chat.loc)}
                  class="block w-full px-3 py-2 text-left text-sm transition
                    {activeChatId === chat.loc
                      ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200'
                      : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'}"
                >
                  <div class="truncate font-medium">{chat.title}</div>
                  <div class="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
                    <span>{chat.messageCount} msg{chat.messageCount === 1 ? '' : 's'}</span>
                    {#if chat.lastMessageAt}
                      <span>·</span>
                      <span>{formatRelativeTime(chat.lastMessageAt)}</span>
                    {/if}
                  </div>
                </button>
                <div class="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    title="Rename"
                    onclick={(e) => { e.stopPropagation(); startRename(chat); }}
                    class="rounded bg-white/90 px-1.5 text-[10px] text-zinc-500 hover:text-zinc-900 dark:bg-zinc-900/90 dark:hover:text-white"
                  >rename</button>
                  <button
                    type="button"
                    title="Delete"
                    onclick={(e) => { e.stopPropagation(); pendingDeleteChatId = chat.loc; }}
                    class="rounded bg-white/90 px-1.5 text-[10px] text-red-500 hover:text-red-700 dark:bg-zinc-900/90"
                  >delete</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </aside>

  <!-- ── Active chat ─────────────────────────────────────────────────── -->
  <main class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#if !activeChatId && !loadingChat}
      <div class="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-zinc-500">
        Select a chat from the list or click <span class="mx-1 font-semibold text-zinc-700 dark:text-zinc-300">+ New chat</span> to start a new one.
      </div>
    {:else}
      <!-- Header -->
      <header class="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold text-zinc-900 dark:text-white">
            {activeChatMeta?.title ?? 'New chat'}
          </h3>
          <div class="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
            {#if activeChatMeta?.conversationName}
              <span class="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {activeChatMeta.conversationName}
              </span>
            {/if}
            {#if activeChatMeta?.stageName}
              <span>Stage: <span class="font-semibold text-zinc-600 dark:text-zinc-300">{activeChatMeta.stageName}</span></span>
            {/if}
          </div>
        </div>
      </header>

      {#if stageToast}
        <div class="mx-4 mt-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
          Stage transitioned: <strong>{stageToast.from || '(start)'}</strong> → <strong>{stageToast.to}</strong>
        </div>
      {/if}

      {#if welcomeNotice}
        <div class="mx-4 mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {welcomeNotice}
        </div>
      {/if}

      <!-- Messages -->
      <div bind:this={messagesEl} class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {#if loadingChat}
          <p class="text-center text-sm text-zinc-400">Loading…</p>
        {/if}
        {#each messages as msg, idx (idx)}
          <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
            {#if msg.role === 'user'}
              <div class="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-indigo-500 px-3 py-2 text-sm text-white">{msg.content}</div>
            {:else}
              <div class="max-w-[85%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                <div class="prose prose-sm dark:prose-invert max-w-none">
                  {@html renderMarkdown(msg.content)}
                </div>
              </div>
            {/if}
          </div>
        {/each}
        {#if sending}
          <div class="flex justify-start">
            <div class="rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800">
              <span class="inline-flex gap-1">
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style="animation-delay: 0ms"></span>
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style="animation-delay: 150ms"></span>
                <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style="animation-delay: 300ms"></span>
              </span>
            </div>
          </div>
        {/if}
      </div>

      {#if turnError}
        <div class="mx-4 mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {turnError}
        </div>
      {/if}

      <!-- Input -->
      <div class="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {#if pendingAttachments.length > 0}
          <div class="mb-2 flex flex-wrap gap-1.5">
            {#each pendingAttachments as att (att.id)}
              <span class="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                <AssetChip asset={att} />
                <button
                  type="button"
                  class="text-zinc-400 hover:text-red-500"
                  onclick={() => removeAttachment(att.id)}
                  aria-label="Remove attachment"
                >×</button>
              </span>
            {/each}
          </div>
        {/if}
        <div class="flex items-end gap-2">
          {#if uploadMemoryId}
            <AssetUploadButton
              memoryId={uploadMemoryId}
              onuploaded={onAssetUploaded}
              disabled={!activeChatId || sending}
            />
          {/if}
          <textarea
            bind:value={input}
            onkeydown={onInputKeydown}
            placeholder={activeChatId ? 'Type your message… (Enter to send, Shift+Enter for a new line)' : 'Start a chat first'}
            rows="2"
            disabled={!activeChatId || sending}
            class="min-h-[42px] w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
          ></textarea>
          <button
            type="button"
            onclick={sendMessage}
            disabled={!activeChatId || sending || input.trim().length === 0}
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style="background: #fb8500;"
          >
            Send
          </button>
        </div>
      </div>
    {/if}
  </main>
</div>

{#if pendingDeleteChatId}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="max-w-md rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="mb-2 text-base font-semibold text-zinc-900 dark:text-white">Delete this chat?</h3>
      <p class="mb-4 text-sm text-zinc-500">
        This will remove the chat and all its messages from your personal memory.
        This can't be undone.
      </p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (pendingDeleteChatId = null)}
          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >Cancel</button>
        <button
          type="button"
          onclick={() => pendingDeleteChatId && confirmDelete(pendingDeleteChatId)}
          class="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >Delete</button>
      </div>
    </div>
  </div>
{/if}
