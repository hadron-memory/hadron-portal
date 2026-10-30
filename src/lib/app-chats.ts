/**
 * #744 — the App's chats as one browsable set.
 *
 * An App can hold several conversations and the page could reach exactly two of
 * them: the agent chat and the team chat, each behind its own tab. A 1:1 chat
 * between two participants lives in the same shared memory, at `chats:<a>-<b>`,
 * and had no path at all — not even through the Memory tab.
 *
 * The two SPECIAL entries are not node locs and never collide with one, because
 * a loc cannot contain a space:
 *   - the agent chat is a saved `Chat` on the linked agent, not a node subtree
 *   - the team chat has its own typed operation (`teamChatMessages`), which
 *     returns the author envelope a raw node read cannot
 */

/** Selector key for the agent conversation — deliberately not a loc. */
export const AGENT_CHAT_KEY = 'agent chat';
/** The one well-known team chat, `hrn:node:hadronmemory.com:specs:cor:agt:020:04`. */
export const TEAM_CHAT_LOC = 'chats:team';

export interface AppChatEntry {
  /** `AGENT_CHAT_KEY`, `TEAM_CHAT_LOC`, or another chat root's loc. */
  key: string;
  /**
   * i18n key for the two WELL-KNOWN entries, null for a discovered chat whose
   * label is its own name and is not translatable.
   *
   * The helper deliberately does not call `t()` itself: it runs in the loader,
   * and a string localized there is baked into the payload before the renderer
   * ever sees it. Every other user-visible string on this route goes through
   * `t()` at render, and this must too (Copilot on #759).
   */
  labelKey: string | null;
  /** The English default for `labelKey`, or the chat's own name. */
  label: string;
  /** Which renderer the tab should use. */
  kind: 'agent' | 'team' | 'other' | 'channel';
  channelId?: string;
  /** Legacy loc deep links resolve only when unambiguous. */
  alias?: string;
  /** The memory holding this chat's nodes — only set for `other`. */
  memoryId?: string;
}

interface ChatRootNode {
  loc: string;
  name?: string | null;
  memoryId?: string | null;
  nodeType?: string | null;
}

/**
 * Build the selector list: agent chat (when the App has one), the team chat
 * (always — an App whose chat is not bootstrapped yet still offers it, because
 * that is how the first message gets posted), then every other chat root.
 *
 * `chats:team` is dropped from the discovered set rather than listed twice, and
 * the special entries lead because they are the two with real read/write
 * surfaces behind them.
 */
export function buildAppChatList(
  chatRoots: ChatRootNode[],
  opts: { hasAgentChat: boolean },
): AppChatEntry[] {
  const out: AppChatEntry[] = [];
  if (opts.hasAgentChat) {
    out.push({ key: AGENT_CHAT_KEY, labelKey: 'app.chats.agent', label: 'Agent chat', kind: 'agent' });
  }
  out.push({ key: TEAM_CHAT_LOC, labelKey: 'app.chats.team', label: 'Team chat', kind: 'team' });

  const others = chatRoots
    .filter((n) => n.loc && n.loc !== TEAM_CHAT_LOC)
    .map((n) => ({
      key: n.loc,
      // A discovered chat's label is its own name — content, not UI copy, so
      // there is nothing to translate.
      labelKey: null,
      // The node's name where it has one; the loc's last segment otherwise, so
      // an unnamed chat is still identifiable rather than blank.
      label: n.name?.trim() || n.loc.split(':').slice(-1)[0] || n.loc,
      kind: 'other' as const,
      memoryId: n.memoryId ?? undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...out, ...others];
}

/**
 * Resolve `?chat=` to an entry. Falls back to the FIRST entry rather than
 * rendering nothing, and reports whether the request was honoured — a chat that
 * has been deleted, or that this viewer cannot read, must not silently look
 * like the one they asked for.
 */
export function resolveSelectedChat(
  chats: AppChatEntry[],
  requested: string | null,
): { selected: AppChatEntry | null; requestedMissing: boolean } {
  if (chats.length === 0) return { selected: null, requestedMissing: !!requested };
  if (!requested) return { selected: chats[0], requestedMissing: false };
  const exact = chats.find((c) => c.key === requested);
  const aliases = chats.filter((c) => c.alias === requested);
  const hit = exact ?? (aliases.length === 1 ? aliases[0] : undefined);
  return hit ? { selected: hit, requestedMissing: false } : { selected: chats[0], requestedMissing: true };
}

/**
 * `?view=full` — the team chat maximised to the whole viewport.
 *
 * In the tab it gets under half the window: the App header, the tab strip, the
 * chat selector and the composer take the rest, and a long engineering thread
 * is read through a letterbox. The full view is a UI state, not a different
 * chat, so it rides the URL the same way `?chat=` does: a link to the full view
 * opens the full view. It is toggled with `replaceState` rather than a
 * navigation — flipping it must not re-run the loader.
 *
 * Only `full` is a value. Anything else, including a bare `?view=`, is the
 * default view — the tab — rather than an error, because the worst case of a
 * malformed value here is the ordinary page.
 */
const CHAT_VIEW_PARAM = 'view';
const CHAT_VIEW_FULL = 'full';

export function chatFullViewFromParams(params: URLSearchParams): boolean {
  return params.get(CHAT_VIEW_PARAM) === CHAT_VIEW_FULL;
}

/**
 * A copy of `url` with the view param set for `full`, or removed for the tab.
 *
 * Entering the full view also CANONICALIZES the selection it belongs to. The
 * page's tab buttons change UI state without rewriting `?tab=`, so a reader
 * who arrived at `?tab=worklog`, clicked Chats and maximised would otherwise
 * mint `?tab=worklog&view=full` — a link that, reloaded, selects the worklog
 * and shows no overlay (Copilot on #832). The full view is only ever the team
 * chat's, so the URL says so.
 */
export function withChatView(url: URL, full: boolean): URL {
  const next = new URL(url.href);
  if (full) {
    next.searchParams.set('tab', 'chats');
    next.searchParams.set('chat', TEAM_CHAT_LOC);
    next.searchParams.set(CHAT_VIEW_PARAM, CHAT_VIEW_FULL);
  } else {
    next.searchParams.delete(CHAT_VIEW_PARAM);
  }
  return next;
}

/** Sort chat-message nodes into transcript order. */
export function sortChatMessages<T extends { loc: string }>(nodes: T[]): T[] {
  // Message locs are allocated `<seq>-<rand>-<author>` with a zero-padded seq,
  // so a plain lexical sort on the loc IS transcript order — and stays correct
  // when two messages share a timestamp, which a createdAt sort would not.
  return [...nodes].sort((a, b) => a.loc.localeCompare(b.loc));
}


/** Registered Channels are addressed by server-issued identity, never just a loc. */
export function withRegisteredChannels(chats: AppChatEntry[], channels: Array<{
  id: string; name: string; loc: string; chatRootUrn: string | null; memoryId: string;
}>, defaultChannelId?: string | null): AppChatEntry[] {
  const remaining = chats.filter(c => c.kind !== 'other' || !channels.some(ch => ch.memoryId === c.memoryId && ch.loc === c.key));
  return [...remaining, ...channels.filter(c => c.id !== defaultChannelId).map(c => ({
    key: c.chatRootUrn ?? c.id, label: c.name, labelKey: null, kind: 'channel' as const,
    channelId: c.id, alias: c.loc, memoryId: c.memoryId,
  }))];
}
