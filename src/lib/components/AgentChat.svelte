<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import type { Chat, ChatMessage } from '$lib/types';
  import AssetUploadButton from '$lib/components/assets/AssetUploadButton.svelte';
  import AssetChip from '$lib/components/assets/AssetChip.svelte';
  import type { AssetSummary } from '$lib/api/assetUpload';
  import { olderCursorFrom } from '$lib/agent-chat-window';
  import { resolveActiveChatFromUrl } from '$lib/components/agent-chat-helpers.js';
  import { scrollTopAfterPrepend } from '$lib/team-chat-refresh';
  import { t } from '$lib/i18n/t.js';
  import { chatScopeStrings } from '$lib/i18n/chat-scope-strings.js';

  function renderMarkdown(text: string): string {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }

  // v2 (spec 006-asset-upload-redesign): memoryId replaces agentUrn for
  // asset uploads. The parent page picks the destination memory (for now,
  // the agent's first writable memory). Multi-writable memory-picker UX
  // is a follow-up; the dominant single-writable case auto-picks.
  // 036-ai-service-config: the App chat tab passes appId + the picked
  // configName so turns resolve in app-context against the chosen config.
  // The agent-builder chat omits both (agent-context, `default`).
  let {
    agentId,
    uploadMemoryId,
    appId,
    configName,
  }: { agentId: string; uploadMemoryId?: string; appId?: string; configName?: string } = $props();

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
    /** Spec 017 — chosen at creation, immutable per FR-002. */
    scope: 'private' | 'shared';
  } | null>(null);

  // Spec 017 — composer-header scope picker. The user's pending choice
  // for the NEXT chat they start. Defaults to 'private' per FR-003.
  let nextChatScope = $state<'private' | 'shared'>('private');
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

  // ── #793: scrollback ─────────────────────────────────────────────────
  // The transcript loads as a bounded WINDOW (the newest page) and grows
  // upward as the reader scrolls. Before this, `/resume` asked for 500
  // messages and rendered them all: a wasted round trip on the common short
  // chat, and on a long one a transcript that simply stopped — message 501
  // was unreachable by any means the UI offered.
  //
  // `olderCursor` is STATE fed only by server pages, never derived from
  // `messages`. The optimistic bubbles below fabricate a seq, so a "minimum seq
  // on screen" cursor could pick a value that was never a real position and page
  // from there, skipping everything in between. See `olderCursorFrom` in
  // $lib/agent-chat-window.
  let olderCursor = $state<number | null>(null);
  let hasOlder = $state(false);
  let loadingOlder = $state(false);

  // Which WINDOW an in-flight scroll-up belongs to (@codex P2 on PR #801).
  //
  // Comparing `activeChatId` alone is not enough, because a chat id is not
  // unique over TIME. Load older from cursor 301, switch to another chat, switch
  // BACK: the reopened chat resumes at its tail (401–500) with a fresh cursor,
  // then the original response lands and its id still matches. It would prepend
  // 201–300 onto that tail and set the cursor to 201 — silently orphaning
  // 301–400 for the rest of the session, with no error and nothing on screen to
  // suggest a gap. That is the same class of invisible hole this whole change
  // exists to close, so an id check is the wrong instrument: the question is not
  // "same conversation?" but "same loaded window?".
  //
  // `resetScrollback` is the single place a window begins, so bumping the
  // counter there covers resume, start, and delete without a per-path guard.
  let windowGeneration = $state(0);

  // Not `scrollTop === 0`: @Holger's ruling on #793 was that a reader should be
  // able to "scroll up without hesitation", and a fetch that only starts once
  // they reach the boundary makes them SEE the boundary. Firing a screenful
  // early means the page is usually already there. Same constant, same reason,
  // as ChatThread — a reader moves between these surfaces.
  const LOAD_OLDER_THRESHOLD_PX = 400;

  function resetScrollback(page?: { messages: ChatMessage[]; hasOlder?: boolean }) {
    olderCursor = page ? olderCursorFrom(page.messages) : null;
    hasOlder = page?.hasOlder ?? false;
    loadingOlder = false;
    // Every reset starts a new window, which invalidates any scroll-up already
    // in flight against the old one.
    windowGeneration += 1;
  }

  /**
   * A seq for an optimistic bubble, which the server has not numbered yet.
   *
   * This used to be `messages.length` — a count of what is ON SCREEN, while
   * `seq` counts what exists in the THREAD. Under pagination those diverge
   * immediately: in a window showing 401–500 it produced 100, a number that
   * both misdescribes the message and COLLIDES with the real seq 100 sitting
   * further back in the same thread. Keying the transcript on `seq` (below)
   * would then throw a duplicate-key error the moment a reader scrolled back
   * far enough to load it.
   *
   * One above the highest seq on screen is collision-free by construction:
   * scrollback only ever loads seqs BELOW the window, so it cannot reach a
   * value at or above this one. It also reads correctly — the message really
   * is the newest thing in the transcript.
   */
  function nextOptimisticSeq(): number {
    let max = 0;
    for (const m of messages) if (m.seq != null && m.seq > max) max = m.seq;
    return max + 1;
  }

  async function maybeLoadOlder() {
    if (!messagesEl || loadingOlder || !hasOlder || olderCursor == null) return;
    if (messagesEl.scrollTop > LOAD_OLDER_THRESHOLD_PX) return;
    const chatId = activeChatId;
    if (!chatId) return;
    const generation = windowGeneration;
    loadingOlder = true;
    // Captured BEFORE the prepend — `scrollHeight` only reflects the new rows
    // once they are in the DOM, which is what the `tick()` below waits for.
    const before = { scrollTop: messagesEl.scrollTop, scrollHeight: messagesEl.scrollHeight };
    try {
      const res = await fetch('/api/agent-chat/older', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, beforeSeq: olderCursor }),
      });
      // A failed fetch is not an exhausted thread: leave `hasOlder` alone so the
      // next scroll retries. Collapsing the two would end the scrollback
      // permanently on one blip.
      if (!res.ok) return;
      const body = await res.json();
      const older: ChatMessage[] = body.messages ?? [];
      // Not just "same chat" — same WINDOW. See `windowGeneration` above: a
      // reopened chat matches on id while holding an entirely different loaded
      // range, and splicing this page into it would leave a permanent hole.
      if (windowGeneration !== generation) return;
      // The SERVER decides whether more exists. A last page that happens to be
      // full looks exactly like a middle one.
      hasOlder = body.hasOlder ?? false;
      if (older.length === 0) return;
      olderCursor = olderCursorFrom(older);
      messages = [...older, ...messages];
      await tick();
      // `if (messagesEl)` IS the mount guard, not a null-safety nicety: Svelte
      // clears a `bind:this` on teardown, and everything from the `fetch` down
      // is inside the teardown window. The `$state` writes above are benign on a
      // dead component; this line touches the DOM, which is not
      // (`hrn:node:hadronmemory.com:hadron-portal:review:async-onmount-runs-after-teardown`). Do not "simplify" it away.
      if (messagesEl) messagesEl.scrollTop = scrollTopAfterPrepend(before, messagesEl.scrollHeight);
    } catch (e) {
      console.warn('[agent-chat] loading older messages failed; will retry on the next scroll:', e);
    } finally {
      // Only the load that OWNS the current window may clear the flag. A stale
      // request resolving after a reset would otherwise unlock a newer load that
      // is still in flight, and the two would prepend the same page twice —
      // trading the gap above for a duplicate. `resetScrollback` already cleared
      // the flag for the new window, so there is nothing to release here.
      if (windowGeneration === generation) loadingOlder = false;
    }
  }

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
    } else if (
      listError === null &&
      new URL(window.location.href).searchParams.has('chat')
    ) {
      // Stale ?chat=<id> (e.g. chat deleted in another tab) — clear it.
      // Gated on a successful list fetch: a transient list failure
      // leaves `chats` empty too, but we MUST NOT throw away a valid
      // ?chat param in that case — the next list reload should still
      // be able to auto-resume it.
      syncChatIdToUrl(null);
    }
  });

  /**
   * Sync the active chat id into the URL as a query param so a reload
   * (or shared link) restores the same chat. Uses SvelteKit's
   * `replaceState` (History-API only, no navigation) so we don't
   * re-run load() / trigger invalidations on every chat switch.
   * Picking another chat is a UI state change, not navigation.
   */
  // #789: this component is gone as far as the user is concerned, but its
  // in-flight work is not. Set in onDestroy and checked by syncChatIdToUrl.
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
  });

  function syncChatIdToUrl(chatId: string | null): void {
    // #789. Every call site can reach this AFTER an `await` — one of them only
    // on some paths, which is the distinction that matters:
    //
    //   onMount else-branch    after await refreshChatList()      always
    //   startNewChat           after await fetch(/start)          always
    //   resumeChat (entry)     after await refreshChatList()      ONLY via onMount;
    //                                                             synchronous
    //                                                             from a click
    //   resumeChat (catch)     after await fetch(/resume)         always
    //   confirmDelete          after await fetch(/delete)         always
    //
    // Svelte does not cancel an async body when the component is destroyed, so
    // any of those continuations can run after the user has navigated away —
    // and this function reads `window.location.href` LIVE, not a URL captured
    // at mount. Without this guard it would rewrite whatever page the user is
    // on now.
    //
    // `resumeChat`'s entry call is the sharp one, because it SETS `?chat=<id>`
    // unconditionally rather than clearing a param, so it does not need the
    // destination to already have one. It is also the one with two callers: a
    // click reaches it synchronously and is never at risk, while onMount
    // reaches it across an await and is. Same line, two lifetimes — which is
    // exactly why the guard belongs here rather than at the caller.
    //
    // Guarded HERE rather than at the five call sites deliberately. This is the
    // only place that mutates the URL, so one check covers every path including
    // the next one someone adds — where five scattered guards are five chances
    // to forget. See
    // hrn:node:hadronmemory.com:hadron-portal:review:async-onmount-runs-after-teardown.
    if (destroyed) return;
    const url = new URL(window.location.href);
    if (chatId) {
      if (url.searchParams.get('chat') === chatId) return;
      url.searchParams.set('chat', chatId);
    } else {
      if (!url.searchParams.has('chat')) return;
      url.searchParams.delete('chat');
    }
    replaceState(url, {});
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
    // A chat that does not exist yet has no history behind it.
    resetScrollback();
    activeChatId = null;
    activeChatMeta = null;
    try {
      const res = await fetch('/api/agent-chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, scope: nextChatScope, appId, configName }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Spec 017 FR-006 / SC-005 — surface the scoped error keys with
        // the documented i18n copy so the user can act on each failure.
        if (body.error === 'shared-chat-requires-app-context') {
          throw new Error(
            `${chatScopeStrings.errorNoAppContextTitle()} — ${chatScopeStrings.errorNoAppContextBody()}`,
          );
        }
        if (body.error === 'shared-chat-not-available-for-app-sessions') {
          throw new Error(chatScopeStrings.errorAppSessionShared());
        }
        throw new Error(body.error ?? 'Failed to start chat');
      }
      activeChatId = body.chatId;
      syncChatIdToUrl(activeChatId);
      activeChatMeta = {
        title: t('agent-chat.new-chat-title', 'New chat'),
        conversationName: body.conversationName,
        stageName: body.stageName,
        // Spec 017 — record the scope used at creation; immutable from
        // here on.
        scope: body.scope === 'shared' ? 'shared' : 'private',
      };
      // Spec 017 D3 (safety > collaboration): reset the picker to
      // 'private' after a successful chat creation so the user makes a
      // deliberate choice for every shared chat, instead of inheriting
      // the previous chat's audience.
      nextChatScope = 'private';
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
      // Keep the human-readable string whole inside one t() key so
      // translators see complete prose. Our t() doesn't interpolate,
      // so we substitute the {error} placeholder after lookup. This
      // is the only call site for this key.
      welcomeNotice = body.welcomeError
        ? t(
            'agent-chat.welcome-error-hint',
            "Couldn't generate a welcome message — type below to start the chat. (Underlying error: {error})",
          ).replace('{error}', body.welcomeError)
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
    // Cleared BEFORE the fetch, not only on success: an in-flight scroll-up
    // from the outgoing chat must not page this one with the old cursor.
    resetScrollback();
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
        // Spec 017 — scope is part of the chat metadata; pulled through
        // from MY_CHATS_QUERY which now selects it.
        scope: body.chat.scope === 'shared' ? 'shared' : 'private',
      };
      messages = body.messages ?? [];
      // #793: the tail page plus the server's word on whether anything precedes
      // it. `hasOlder` comes from the endpoint, never from `messages.length` —
      // a full last page is indistinguishable from a middle one.
      resetScrollback({ messages, hasOlder: body.hasOlder });
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
        seq: nextOptimisticSeq(),
        createdAt: new Date().toISOString(),
      },
    ];
    scrollMessagesToBottom();

    try {
      const res = await fetch('/api/agent-chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, chatId, userMessage: text, appId, configName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Turn failed');

      // Assistant bubble
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: body.assistantMessage ?? '',
          seq: nextOptimisticSeq(),
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
        resetScrollback();
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
      <!-- Spec 017 — segmented scope picker. The user's choice here
           dictates the next chat's tier when they click "+ New chat".
           Default = Private per FR-003. Hidden Shared option (per
           FR-006/SC-005) would need an AppMember check that isn't yet
           plumbed into this component — the server still rejects an
           unqualified Shared request and the rejection surfaces inline
           below as a turnError. -->
      <div
        class="mb-2 grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-[11px] font-medium dark:border-zinc-800 dark:bg-zinc-950"
        role="group"
        aria-label={t('agent-chat.scope-picker.label', 'Chat scope')}
      >
        <button
          type="button"
          onclick={() => (nextChatScope = 'private')}
          class="rounded-md px-2 py-1 transition
            {nextChatScope === 'private'
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'}"
          title={chatScopeStrings.pickerHelpPrivate()}
          aria-pressed={nextChatScope === 'private'}
        >
          {chatScopeStrings.pickerPrivate()}
        </button>
        <button
          type="button"
          onclick={() => (nextChatScope = 'shared')}
          class="rounded-md px-2 py-1 transition
            {nextChatScope === 'shared'
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'}"
          title={chatScopeStrings.pickerHelpShared()}
          aria-pressed={nextChatScope === 'shared'}
        >
          {chatScopeStrings.pickerSharedFallback()}
        </button>
      </div>
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
                  <div class="flex items-center gap-1.5">
                    <span class="truncate font-medium">{chat.title}</span>
                    <!-- Spec 017 — scope badge per row (FR-009) -->
                    <span
                      class="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide
                        {chat.scope === 'shared'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
                      title={chat.scope === 'shared'
                        ? chatScopeStrings.pickerHelpShared()
                        : chatScopeStrings.pickerHelpPrivate()}
                    >
                      {chat.scope === 'shared'
                        ? chatScopeStrings.badgeShared()
                        : chatScopeStrings.badgePrivate()}
                    </span>
                  </div>
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
          <div class="flex items-center gap-2">
            <h3 class="truncate text-sm font-semibold text-zinc-900 dark:text-white">
              {activeChatMeta?.title ?? t('agent-chat.new-chat-title', 'New chat')}
            </h3>
            {#if activeChatMeta}
              <!-- Spec 017 — active-chat scope label (FR-010): keep the
                   user aware of the audience while they're composing. -->
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide
                  {activeChatMeta.scope === 'shared'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}"
                title={activeChatMeta.scope === 'shared'
                  ? chatScopeStrings.pickerHelpShared()
                  : chatScopeStrings.pickerHelpPrivate()}
              >
                {activeChatMeta.scope === 'shared'
                  ? chatScopeStrings.badgeShared()
                  : chatScopeStrings.badgePrivate()}
              </span>
            {/if}
          </div>
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
      <!-- #793: `onscroll` is what drives the scrollback. It is the whole
           feature — a `maybeLoadOlder` attached to nothing type-checks, passes
           every unit test, and silently does nothing (#799). -->
      <div
        bind:this={messagesEl}
        onscroll={maybeLoadOlder}
        class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {#if loadingChat}
          <p class="text-center text-sm text-zinc-400">Loading…</p>
        {/if}
        {#if loadingOlder}
          <p class="text-center text-xs text-zinc-400">
            {t('agent-chat.loading-older', 'Loading earlier messages…')}
          </p>
        {/if}
        <!-- Keyed by seq, not by index (@copilot on PR #801). With an index key
             a prepended page shifts every existing row's key, so Svelte
             re-renders the whole transcript — including `renderMarkdown` for
             every assistant bubble — on each scroll-up. `ChatThread` and
             `TeamChatThread` both key on a stable id; this surface has no `id`
             on the wire, and `seq` only became usable as one once the
             optimistic bubbles stopped fabricating a colliding value (see
             `nextOptimisticSeq`). Counterless legacy rows fall back to their
             index, which is stable for them specifically: they are the OLDEST
             part of a thread, so nothing is ever prepended in front of them. -->
        {#each messages as msg, idx (msg.seq ?? `legacy-${idx}`)}
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
  {@const pendingDeleteChat = chats.find((c) => c.loc === pendingDeleteChatId)}
  {@const pendingDeleteScope =
    pendingDeleteChat?.scope === 'shared' ? 'shared' : 'private'}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="max-w-md rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="mb-2 text-base font-semibold text-zinc-900 dark:text-white">Delete this chat?</h3>
      <p class="mb-4 text-sm text-zinc-500">
        {pendingDeleteScope === 'shared'
          ? chatScopeStrings.deleteConfirmShared()
          : chatScopeStrings.deleteConfirmPrivate()}
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
