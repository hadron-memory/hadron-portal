<script lang="ts">
  import ServedPrompt from '$lib/components/ServedPrompt.svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { renderChatMarkdown } from '$lib/markdown/chat-markdown';
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
  import { agentChatRowStrings } from '$lib/i18n/agent-chat-row-strings.js';
  import {
    chatAiChoiceLabel,
    initialChatAiChoice,
    type ChatAiChoiceOption,
  } from '$lib/chat-ai-choice';

  function renderMarkdown(text: string): string {
    const raw = renderChatMarkdown(text);
    return DOMPurify.sanitize(raw);
  }

  // v2 (spec 006-asset-upload-redesign): memoryId replaces agentUrn for
  // asset uploads. The parent page picks the destination memory (for now,
  // the agent's first writable memory). Multi-writable memory-picker UX
  // is a follow-up; the dominant single-writable case auto-picks.
  // 036-ai-service-config: the App chat tab passes appId so turns resolve in
  // app-context. portal#1963 (hadron-server#3957): it also passes the server's
  // list of AI config choices, and the chat shows a dropdown over them. The
  // agent-builder chat omits both (agent-context, `default`, no dropdown).
  let {
    agentId,
    uploadMemoryId,
    appId,
    aiChoices = null,
  }: { agentId: string; uploadMemoryId?: string; appId?: string; aiChoices?: ChatAiChoiceOption[] | null } = $props();

  // portal#1963: the choice stored with the open chat (null for a new chat, or none stored), and the one the
  // user picked in the dropdown. A pick is what gets SENT, so the server stores it; until the user picks, the
  // chat runs the shown config by name and sends no choice, exactly as before. The shown value mirrors the
  // server's order: the stored choice while the list still has it, else the App's chatbot config, else default.
  let storedAiChoice = $state<string | null>(null);
  let pickedAiChoice = $state<string | null>(null);
  const hasAiChoices = $derived(Array.isArray(aiChoices) && aiChoices.length > 0);
  // A pick counts only while the list still has it: the list drops a config deleted or disabled on the AI
  // tab, and config ids are per App, so a pick made in one App never carries into another's list.
  const livePickedAiChoice = $derived(
    pickedAiChoice !== null && hasAiChoices && aiChoices!.some((o) => o.value === pickedAiChoice) ? pickedAiChoice : null,
  );
  const shownAiChoice = $derived(
    hasAiChoices ? (livePickedAiChoice ?? initialChatAiChoice(aiChoices!, storedAiChoice)) : null,
  );
  /** The body fields a start or a turn carries for the AI config: the pick only. No config name is ever sent;
   *  the portal server resolves from the choice, else the chat's stored one (portal#1963, Juliet's BLIND F1). */
  function aiConfigFields(): { aiConfigChoice?: string } {
    return hasAiChoices && livePickedAiChoice !== null ? { aiConfigChoice: livePickedAiChoice } : {};
  }

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
    /** portal#2065: conversations this chat has completed, first completion first. */
    completed: string[];
  } | null>(null);
  // portal#2065: one quiet line about the last turn's routing (completed / returned / stage refused). The region below is
  // mounted empty and its text replaced, so the change is announced. Scoped to its chat.
  type ProgressNote = { tone: 'good' | 'neutral'; text: string };
  let progressNotice = $state<{ chatId: string; notes: ProgressNote[] } | null>(null);

  // Spec 017 — composer-header scope picker. The user's pending choice
  // for the NEXT chat they start. Defaults to 'private' per FR-003.
  let nextChatScope = $state<'private' | 'shared'>('private');
  let messages = $state<ChatMessage[]>([]);
  let loadingChat = $state(false);

  let input = $state('');
  let sending = $state(false);
  let turnError = $state<string | null>(null);
  // portal#916: set only for a turn the server half-saved (see handlePartialTurn). Carries the chat it belongs to
  // so it can never show in, or reload, another chat.
  let partialTurnNotice = $state<{ chatId: string; text: string; refreshFailed: boolean } | null>(null);

  // ── portal#2088: one pane at a time while the PANEL is narrow ──────────
  // The breakpoint is the chat panel's own width (`@container`, `@2xl` =
  // 42rem), not the viewport's: on the App page the app nav shows from `sm`,
  // so a 640-900px window leaves a phone-sized panel (#2090 QA: a 26px
  // composer at 640). Which pane shows is CSS (`hidden @2xl:flex`), never
  // script, so the server-rendered first paint is already right (#747's
  // pattern). From `@2xl` up both panes always show and none of this changes
  // anything.
  // `showList` is only the phone's view choice: Back sets it and leaves the
  // selected chat, its transcript and its draft exactly as they were.
  let showList = $state(false);
  const phonePane = $derived(activeChatId !== null && !showList ? 'chat' : 'list');
  let rootEl = $state<HTMLDivElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  let headingEl = $state<HTMLHeadingElement | null>(null);
  let newChatButton = $state<HTMLButtonElement | null>(null);
  // Focus follows the view only where the view changed; on a desktop the list
  // row the person clicked keeps focus, as before. Read at event time, not to
  // decide what renders.
  // One pane showing means the list is display:none once a chat is open.
  const onePaneShowing = () => !!listEl && getComputedStyle(listEl).display === 'none';
  async function focusConversation() {
    await tick();
    // The heading, not the textarea: focusing the textarea raises the phone
    // keyboard over a chat the person has not read yet.
    if (!destroyed && onePaneShowing()) headingEl?.focus();
  }
  async function backToChats() {
    showList = true;
    syncChatIdToUrl(null);
    await tick();
    if (destroyed) return;
    const row = activeChatId
      ? rootEl?.querySelector<HTMLElement>(`[data-chat-row="${CSS.escape(activeChatId)}"]`)
      : null;
    (row ?? newChatButton)?.focus();
  }

  // Inline rename state
  let renamingChatId = $state<string | null>(null);
  let renameValue = $state('');
  // Enter or Escape in the rename field hands focus back to the row's Rename
  // (portal#2098); a blur by clicking elsewhere leaves focus where it went.
  let renameReturnsFocus = false;

  /** Focus one of a row's controls after the next render, if it is still there. */
  async function focusRowControl(attribute: 'data-chat-row' | 'data-chat-rename' | 'data-chat-delete', chatId: string) {
    await tick();
    if (destroyed) return;
    rootEl?.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(chatId)}"]`)?.focus();
  }

  // The row actions' shared look: 44px targets, neutral text that reaches
  // 4.5:1 on selected and unselected rows, and a visible focus ring. Hover
  // colours are per action: in one class string with Delete's red, the neutral
  // hover utilities sort later in the stylesheet and win. The label
  // sits at the top of its target, on the meta line's text; the rest of the
  // 44px falls below it.
  const rowActionClass =
    'inline-flex min-h-11 min-w-11 items-start justify-center pt-0.5 rounded px-1.5 text-[11px] font-medium text-zinc-600 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 dark:text-zinc-300';

  // Delete confirm state
  let pendingDeleteChatId = $state<string | null>(null);
  // Whether the current turn error was raised from the list (a failed
  // delete). On one pane after Back the chat stays selected, so this is what
  // lets the list show it (#2110). Set with every turn error, never by text.
  let turnErrorFromList = $state(false);
  function setTurnError(message: string | null, { fromList = false }: { fromList?: boolean } = {}) {
    turnError = message;
    turnErrorFromList = message !== null && fromList;
  }

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
      // A page load is not the person choosing a chat: show it, don't move focus.
      await resumeChat(target, { focus: false });
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
    setTurnError(null);
    partialTurnNotice = null;
    progressNotice = null;
    messages = [];
    // A chat that does not exist yet has no history behind it.
    resetScrollback();
    // portal#1963: leaving an open chat for a new one starts from the preselection, never from the old chat's
    // choice. A pick made while no chat was open is meant for this new chat and is kept.
    if (activeChatId !== null) pickedAiChoice = null;
    storedAiChoice = null;
    activeChatId = null;
    activeChatMeta = null;
    try {
      const res = await fetch('/api/agent-chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, scope: nextChatScope, appId, ...aiConfigFields() }),
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
      showList = false;
      syncChatIdToUrl(activeChatId);
      void focusConversation();
      activeChatMeta = {
        title: t('agent-chat.new-chat-title', 'New chat'),
        conversationName: body.conversationName,
        stageName: body.stageName,
        // Spec 017 — record the scope used at creation; immutable from
        // here on.
        scope: body.scope === 'shared' ? 'shared' : 'private',
        completed: [],
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
      welcomeNotice = body.welcomeError && body.welcomePartial !== true
        ? t(
            'agent-chat.welcome-error-hint',
            "Couldn't generate a welcome message — type below to start the chat. (Underlying error: {error})",
            { error: body.welcomeError },
          )
        : null;
      applyRouting(body.chatId, body);
      if (body.welcomePartial === true && typeof body.welcomeError === 'string') {
        // portal#2065 B3 on the welcome turn: the reply was saved, so show it and say so (no "couldn't generate" hint).
        welcomeNotice = null;
        await handlePartialTurn(body.chatId, windowGeneration, body.welcomeError);
      }
      await refreshChatList();
      scrollMessagesToBottom();
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : 'Failed to start chat');
    } finally {
      loadingChat = false;
    }
  }

  async function resumeChat(chatId: string, { focus = true }: { focus?: boolean } = {}) {
    if (activeChatId === chatId) {
      // portal#2088: after Back on a phone the chat is still selected and loaded;
      // choosing it again only shows it again. No refetch, nothing reset.
      if (showList) {
        showList = false;
        syncChatIdToUrl(chatId);
        if (focus) void focusConversation();
      }
      return;
    }
    showList = false;
    loadingChat = true;
    setTurnError(null);
    partialTurnNotice = null;
    progressNotice = null;
    welcomeNotice = null;
    messages = [];
    // Cleared BEFORE the fetch, not only on success: an in-flight scroll-up
    // from the outgoing chat must not page this one with the old cursor.
    resetScrollback();
    activeChatId = chatId;
    syncChatIdToUrl(chatId);
    if (focus) void focusConversation();
    activeChatMeta = null;
    // portal#1963: the reopened chat shows its own stored choice, not the previous chat's pick.
    pickedAiChoice = null;
    storedAiChoice = chats.find((c) => c.loc === chatId || c.id === chatId)?.aiConfigChoice ?? null;
    try {
      const res = await fetch('/api/agent-chat/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, chatId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to resume chat');
      // The fresh read wins over the list row, unless the user picked while it was in flight.
      if (activeChatId === chatId) storedAiChoice = body.chat?.aiConfigChoice ?? null;
      activeChatMeta = {
        title: body.chat.title,
        conversationName: body.chat.conversationName,
        stageName: body.chat.stageName,
        // Spec 017 — scope is part of the chat metadata; pulled through
        // from MY_CHATS_QUERY which now selects it.
        scope: body.chat.scope === 'shared' ? 'shared' : 'private',
        completed: [...new Set<string>(body.chat.completedConversations ?? [])],
      };
      // Chat switch stays tolerant, as before #916: a missing list opens an empty
      // transcript. The strict check lives in the partial-turn reload only, where
      // the transcript on screen must not be replaced by nothing.
      messages = body.messages ?? [];
      // #793: the tail page plus the server's word on whether anything precedes
      // it. `hasOlder` comes from the endpoint, never from `messages.length` —
      // a full last page is indistinguishable from a middle one.
      resetScrollback({ messages, hasOlder: body.hasOlder });
      scrollMessagesToBottom();
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : 'Failed to resume chat');
      activeChatId = null;
      syncChatIdToUrl(null);
    } finally {
      loadingChat = false;
    }
  }

  // ── Sending a message ────────────────────────────────────────────────
  /**
   * portal#2065: completion, detour return, refused stage, from a turn or the welcome turn. Strings are ours (t()), never
   * server text; names are the author's own, shown as the header already shows them. routingSkipped shows nothing (B5).
   * The done list never holds a name twice.
   */
  function applyRouting(chatId: string, body: Record<string, unknown>) {
    if (!activeChatMeta || activeChatId !== chatId) return;
    const done = typeof body.conversationCompleted === 'string' && body.conversationCompleted ? body.conversationCompleted : null;
    if (done && !activeChatMeta.completed.includes(done)) {
      activeChatMeta = { ...activeChatMeta, completed: [...activeChatMeta.completed, done] };
    }
    const notes: ProgressNote[] = [];
    if (done) notes.push({ tone: 'good', text: t('agent-chat.progress.completed', 'Done: {name}', { name: done }) });
    if (body.detourReturned === true) {
      const stage = typeof body.newStageName === 'string' && body.newStageName ? body.newStageName : '';
      notes.push({ tone: 'good', text: stage ? t('agent-chat.progress.detour-returned', 'Back to {where}', { where: stage }) : t('agent-chat.progress.detour-returned-plain', 'Back to where we were') });
    }
    if (typeof body.rejectedNextStage === 'string' && body.rejectedNextStage) {
      notes.push({ tone: 'neutral', text: t('agent-chat.progress.stage-refused', 'Couldn\'t move to "{name}", so we\'re staying on this step.', { name: body.rejectedNextStage }) });
    }
    progressNotice = notes.length ? { chatId, notes } : null;
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !activeChatId || sending) return;
    const chatId = activeChatId;
    // portal#916: the window this turn was issued in. A chat id is not unique over time (leave and reopen the same
    // chat and it is a new window), so the fence is captured HERE, when the turn is issued, never after its response.
    const issuedWindow = windowGeneration;
    input = '';
    sending = true;
    setTurnError(null);
    partialTurnNotice = null;
    progressNotice = null;
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
        body: JSON.stringify({ agentId, chatId, userMessage: text, appId, ...aiConfigFields() }),
      });
      const body = await res.json();
      if (!res.ok) {
        // portal#916: the server saved both messages before refusing the extraction. A rollback plus refill would
        // invite a resend that duplicates the turn, so reload instead. The route sets the flag only for a
        // recognised structured marker; without it this is today's failure path, unchanged.
        if (res.status === 409 && body.partialTurn === true) {
          await handlePartialTurn(chatId, issuedWindow, typeof body.error === 'string' && body.error.trim() !== '' ? body.error : t('agent-chat.partial-turn.generic', "Your message was sent and the reply was saved. You don't need to send it again."));
          return;
        }
        throw new Error(body.error ?? 'Turn failed');
      }

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

      applyRouting(chatId, body);

      // Refresh the list so lastMessageAt + derived title update
      refreshChatList();
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : 'Turn failed');
      // Rollback the optimistic user bubble
      messages = messages.slice(0, -1);
      input = text;
    } finally {
      sending = false;
    }
  }

  /**
   * portal#916: a turn the server half-saved (reply and counter saved, extraction refused, stage not run).
   * Reloads the conversation through the same resume read, shows the route's fixed message as a notice, keeps the
   * current stage (no toast), and NEVER touches `input`: the sent text is not put back, and a draft the user typed
   * since stays. Applies only to the chat the turn belonged to, and to the window it was sent in.
   */
  async function handlePartialTurn(chatId: string, generation: number, notice: string) {
    // An old turn belongs to the window it was issued in: if the user left and reopened the chat since, the fresh
    // window already loaded the saved messages and this turn must neither reload it again nor explain itself there.
    if (destroyed || activeChatId !== chatId || windowGeneration !== generation) return;
    let reloaded = false;
    try {
      const res = await fetch('/api/agent-chat/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, chatId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error('reload failed');
      // The user may have switched chats, or reopened this one, while the read was in flight.
      if (destroyed || activeChatId !== chatId || windowGeneration !== generation) return;
      // A 200 without a messages list is not a reload: keep what is shown and say so.
      if (!Array.isArray(body.messages)) throw new Error('reload returned no messages');
      messages = body.messages;
      resetScrollback({ messages, hasOlder: body.hasOlder });
      reloaded = true;
      scrollMessagesToBottom();
    } catch {
      if (destroyed || activeChatId !== chatId || windowGeneration !== generation) return;
    }
    // Truthful when the reload failed: the reply is saved, but this screen may not show it.
    partialTurnNotice = { chatId, text: notice, refreshFailed: !reloaded };
    refreshChatList();
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
    if (renameReturnsFocus) {
      renameReturnsFocus = false;
      void focusRowControl('data-chat-rename', chatId);
    }
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
      setTurnError(e instanceof Error ? e.message : 'Rename failed');
    }
  }
  function cancelRename() {
    const chatId = renamingChatId;
    renamingChatId = null;
    renameValue = '';
    if (chatId) void focusRowControl('data-chat-rename', chatId);
  }
  function cancelDelete() {
    const chatId = pendingDeleteChatId;
    pendingDeleteChatId = null;
    if (chatId) void focusRowControl('data-chat-delete', chatId);
  }

  async function confirmDelete(chatId: string) {
    pendingDeleteChatId = null;
    // Where focus goes once the row is gone: the next row, else the previous
    // one, else "+ New chat" (portal#2098).
    const at = chats.findIndex((c) => c.loc === chatId);
    const neighbour = chats[at + 1] ?? chats[at - 1] ?? null;
    // The delete and the list refresh are network round trips. If the person
    // moves on meanwhile (focuses or presses anything, anywhere), the focus is
    // theirs: don't pull it back to the list when the answer lands.
    let movedOn = false;
    const moveOn = () => (movedOn = true);
    document.addEventListener('focusin', moveOn, true);
    document.addEventListener('pointerdown', moveOn, true);
    document.addEventListener('keydown', moveOn, true);
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
        partialTurnNotice = null;
      }
      await refreshChatList();
      await tick();
      if (destroyed || movedOn) return;
      const next = neighbour && chats.some((c) => c.loc === neighbour.loc)
        ? rootEl?.querySelector<HTMLElement>(`[data-chat-row="${CSS.escape(neighbour.loc)}"]`)
        : null;
      (next ?? newChatButton)?.focus();
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : 'Delete failed', { fromList: true });
      // The dialog has closed, so a failed delete hands focus back to that
      // row's Delete, under the same ownership rule as a success: not once
      // the person has moved on (portal#2104). If the row went away
      // meanwhile, the neighbour rule above applies.
      await tick();
      if (destroyed || movedOn) return;
      const find = (attribute: string, loc: string) =>
        chats.some((c) => c.loc === loc)
          ? rootEl?.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(loc)}"]`)
          : null;
      (find('data-chat-delete', chatId) ?? (neighbour && find('data-chat-row', neighbour.loc)) ?? newChatButton)?.focus();
    } finally {
      document.removeEventListener('focusin', moveOn, true);
      document.removeEventListener('pointerdown', moveOn, true);
      document.removeEventListener('keydown', moveOn, true);
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
<div bind:this={rootEl} class="@container flex h-full min-h-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
  <!-- ── Chat list sidebar ───────────────────────────────────────────── -->
  <!-- portal#2088: below `@2xl` (panel width) the list is the whole panel while it is the
       phone's pane, and display:none (out of the tab order too) otherwise. -->
  <aside
    bind:this={listEl}
    class="w-full min-w-0 flex-col border-zinc-200 @2xl:w-64 @2xl:shrink-0 @2xl:border-r dark:border-zinc-800
      {phonePane === 'list' ? 'flex' : 'hidden @2xl:flex'}"
  >
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
        bind:this={newChatButton}
        type="button"
        onclick={startNewChat}
        class="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style="background: #fb8500;"
        disabled={loadingChat}
      >
        + New chat
      </button>
    </div>
    <!-- portal#2088: on a phone a refused or failed start leaves the person on
         the list, so its message shows here. From `@2xl` (panel width) up the conversation
         pane's copy below shows instead; only one is ever displayed. After Back
         the chat stays selected behind the list; an error raised from the list
         (a failed delete, #2110) still shows here, a chat's own error does not. -->
    {#if turnError && !loadingChat && (!activeChatId || (phonePane === 'list' && turnErrorFromList))}
      <div role="alert" class="m-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 [overflow-wrap:anywhere] @2xl:hidden dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {turnError}
      </div>
    {/if}
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
            <!-- portal#2098: Rename and Delete are always in the DOM and the
                 tab order, revealed by opacity, never display:none. Mouse on
                 a wide panel: quiet at rest, shown on hover, focus and the
                 selected row. Narrow panel (below @2xl) or touch: always
                 shown. At every width and pointer they sit on the meta line,
                 in flow, so the title keeps the row's width and they never
                 cover the title or scope badge (#2095). -->
            <li
              class="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center transition
                {activeChatId === chat.loc
                  ? 'bg-indigo-50 dark:bg-indigo-950/40'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}"
            >
              {#if renamingChatId === chat.loc}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  type="text"
                  bind:value={renameValue}
                  aria-label={agentChatRowStrings.renameInput(chat.title)}
                  onblur={() => commitRename(chat.loc)}
                  onkeydown={(e) => {
                    // preventDefault: focus returns to Rename before this key's
                    // keypress, which would otherwise press Rename again.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      renameReturnsFocus = true;
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  autofocus
                  class="col-span-2 w-full border-0 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-900 dark:text-white"
                />
              {:else}
                <button
                  type="button"
                  data-chat-row={chat.loc}
                  onclick={() => resumeChat(chat.loc)}
                  class="col-span-2 row-start-1 block min-w-0 px-3 pb-0.5 pt-2 text-left text-sm pointer-coarse:min-h-11 after:absolute after:inset-0 after:content-['']
                    {activeChatId === chat.loc
                      ? 'text-indigo-900 dark:text-indigo-200'
                      : 'text-zinc-700 dark:text-zinc-300'}"
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
                </button>
                <!-- The existing row button's transparent pseudo-element
                     stretches across the row. Actions sit above it in their
                     own grid cell; meta text passes pointer hits through. No
                     extra opener or keyboard stop is introduced (#2105). -->
                <div
                  data-chat-meta={chat.loc}
                  class="pointer-events-none col-start-1 row-start-2 flex items-start gap-2 self-stretch px-3 pt-0.5 text-[10px] text-zinc-400"
                >
                  <span>{agentChatRowStrings.messages(chat.messageCount)}</span>
                  {#if chat.lastMessageAt}
                    <span>{agentChatRowStrings.separator()}</span>
                    <span>{formatRelativeTime(chat.lastMessageAt)}</span>
                  {/if}
                </div>
                <div
                  class="relative z-10 col-start-2 row-start-2 flex gap-0.5 pb-1 pr-1
                    {activeChatId === chat.loc
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 @max-2xl:opacity-100 pointer-coarse:opacity-100'}"
                >
                  <button
                    type="button"
                    data-chat-rename={chat.loc}
                    aria-label={agentChatRowStrings.rename(chat.title)}
                    title={agentChatRowStrings.rename(chat.title)}
                    onclick={(e) => { e.stopPropagation(); startRename(chat); }}
                    class="{rowActionClass} hover:text-zinc-900 dark:hover:text-white"
                  >{agentChatRowStrings.renameShort()}</button>
                  <button
                    type="button"
                    data-chat-delete={chat.loc}
                    aria-label={agentChatRowStrings.delete(chat.title)}
                    title={agentChatRowStrings.delete(chat.title)}
                    onclick={(e) => { e.stopPropagation(); pendingDeleteChatId = chat.loc; }}
                    class="{rowActionClass} hover:text-red-700 focus-visible:text-red-700 active:text-red-700 dark:hover:text-red-400 dark:focus-visible:text-red-400 dark:active:text-red-400"
                  >{agentChatRowStrings.deleteShort()}</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </aside>

  <!-- ── Active chat ─────────────────────────────────────────────────── -->
  <main class="min-h-0 min-w-0 flex-1 flex-col {phonePane === 'chat' ? 'flex' : 'hidden @2xl:flex'}">
    {#if !activeChatId && !loadingChat}
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-sm text-zinc-500">
        <p>Select a chat from the list or click <span class="mx-1 font-semibold text-zinc-700 dark:text-zinc-300">+ New chat</span> to start a new one.</p>
        <!-- portal#1611: a refused or failed start has no chat pane to show its
             error in; without this the user saw nothing at all. -->
        {#if turnError}
          <div role="alert" class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 [overflow-wrap:anywhere] dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {turnError}
          </div>
        {/if}
      </div>
    {:else}
      <!-- Header -->
      <header class="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 @2xl:gap-3 dark:border-zinc-800">
        <!-- portal#2088: phone-only view navigation back to the list. Neutral
             chrome (never the warm accent); it changes no chat. -->
        <button
          type="button"
          onclick={backToChats}
          aria-label={t('agent-chat.back.aria', 'Back to chats')}
          class="-my-2 -ml-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 @2xl:hidden dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
            <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clip-rule="evenodd" />
          </svg>
          {t('agent-chat.back.label', 'Chats')}
        </button>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 bind:this={headingEl} tabindex="-1" class="truncate text-sm font-semibold text-zinc-900 dark:text-white">
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
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400 [overflow-wrap:anywhere]">
            {#if activeChatMeta?.conversationName}
              <span class="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {activeChatMeta.conversationName}
              </span>
            {/if}
            {#if activeChatMeta?.stageName}
              <span>Stage: <span class="font-semibold text-zinc-600 dark:text-zinc-300">{activeChatMeta.stageName}</span></span>
            {/if}
          </div>
          {#if activeChatMeta && activeChatMeta.completed.length > 0}
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400" data-testid="completed-conversations-row">
              <span>{t('agent-chat.progress.done-label', 'Done')}:</span>
              <ul class="flex flex-wrap gap-1.5" data-testid="completed-conversations">
                {#each activeChatMeta.completed as name (name)}
                  <li class="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{name}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </header>

      {#if stageToast}
        <div class="mx-4 mt-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
          Stage transitioned: <strong>{stageToast.from || '(start)'}</strong> → <strong>{stageToast.to}</strong>
        </div>
      {/if}

      <div role="status" data-testid="chat-progress-notice" class={progressNotice && progressNotice.chatId === activeChatId ? 'mx-4 mt-2 space-y-1' : 'sr-only'}>
        {#if progressNotice && progressNotice.chatId === activeChatId}
          {#each progressNotice.notes as note}
            <p class="rounded-md border px-3 py-2 text-xs {note.tone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'}">{note.text}</p>
          {/each}
        {/if}
      </div>

      {#if welcomeNotice}
        <div class="mx-4 mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {welcomeNotice}
        </div>
      {/if}

      <!-- portal#1665: what this chat was given (hrn:node:hadronmemory.com:specs:cor:agt:040:03), for the chat OPEN here. Asked by
           {agentId, chatId} and found in the viewer's own list server-side; an end user who does not
           manage the App gets an empty answer and sees nothing (no "no records" text). -->
      {#if activeChatId && !loadingChat}
        <div class="mx-4 mt-2">
          {#key activeChatId}
            <ServedPrompt collapsible source="chat" {agentId} chatId={activeChatId} />
          {/key}
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
              <div class="min-w-0 max-w-[85%] whitespace-pre-wrap rounded-2xl bg-indigo-500 [overflow-wrap:anywhere] px-3 py-2 text-sm text-white">{msg.content}</div>
            {:else}
              <div class="min-w-0 max-w-[85%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 [overflow-wrap:anywhere] dark:bg-zinc-800 dark:text-zinc-100">
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

      <!-- The status region stays mounted (empty) so the notice that arrives later is announced; a live region that is
           mounted already populated is not reliably read. Margins live on the notice, not the region. -->
      <div role="status" data-testid="partial-turn-notice">
        {#if partialTurnNotice && partialTurnNotice.chatId === activeChatId}
          <div class="mx-4 mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p>{partialTurnNotice.text}</p>
            {#if partialTurnNotice.refreshFailed}
              <p class="mt-1">{t('agent-chat.partial-turn.refresh-failed', "The conversation couldn't be refreshed, so the saved messages may not be shown here. Reload the page to see them.")}</p>
            {/if}
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
        <!-- portal#2088: below `@2xl` (panel width) the textarea keeps at least 200px and Send
             wraps under it when the row is too narrow (DOM and Tab order
             unchanged); from `@2xl` up, one row as before. -->
        <div class="flex flex-wrap items-end gap-2 @2xl:flex-nowrap">
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
            class="min-h-[42px] w-full min-w-[12.5rem] flex-1 resize-none rounded-lg @2xl:min-w-0 border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
          ></textarea>
          <button
            type="button"
            onclick={sendMessage}
            disabled={!activeChatId || sending || input.trim().length === 0}
            class="ml-auto rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 @2xl:ml-0"
            style="background: #fb8500;"
          >
            Send
          </button>
        </div>
      </div>
    {/if}
    {#if hasAiChoices}
      <!-- portal#1963: the AI config for this chat (or, with none open, the next one). Below the chat, where
           model pickers sit in most chat apps. A config the portal can't run yet stays listed, disabled, with
           its reason in the label: the server's list never carries a config's own disabled state.
           `min-w-0` lets a long label give way on a phone (#740). -->
      <div class="flex items-center gap-2 border-t border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <label for="agent-chat-ai-config" class="shrink-0 text-zinc-500 dark:text-zinc-400">{t('agent-chat.ai-config.label', 'AI config')}</label>
        <select
          id="agent-chat-ai-config"
          value={shownAiChoice ?? ''}
          disabled={sending || loadingChat}
          onchange={(e) => (pickedAiChoice = e.currentTarget.value)}
          class="min-w-0 truncate rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          {#each aiChoices ?? [] as choice (choice.value)}
            <option value={choice.value} disabled={choice.unavailableReason !== null}>{chatAiChoiceLabel(choice)}</option>
          {/each}
        </select>
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
          onclick={cancelDelete}
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
