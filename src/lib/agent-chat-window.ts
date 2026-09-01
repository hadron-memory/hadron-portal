import type { ChatMessage } from '$lib/types';

/**
 * #793 — the agent chat's display window and the rules for paging it.
 *
 * Deliberately NOT under `$lib/server`: `AgentChat.svelte` needs the same
 * cursor rule the endpoints use, and SvelteKit refuses a `$lib/server` import
 * from client code. Two copies of a paging rule is how a client ends up asking
 * for a page the server would never return.
 *
 * The read itself lives in `$lib/server/agent-chat` — that part IS server-only.
 */

/**
 * The resume endpoint used to ask for `limit: 500` and render whatever came
 * back, which is the same unbounded read the node and team surfaces already
 * shed. 500 is not a page size; it is a guess that a conversation will not get
 * long, and it is wrong in both directions — a wasted round trip for the common
 * short chat, and a truncated transcript with no way to reach the rest for the
 * long one. The reader had no scrollback at all: message 501 was simply gone.
 *
 * 100 matches `CHAT_PAGE_SIZE` on the node surface. It is also the server's own
 * default `take` for `chatHistory`, so an omitted limit and an explicit one now
 * agree.
 */
export const AGENT_CHAT_PAGE_SIZE = 100;

export interface AgentChatPage {
  /** Oldest-first, the way every chat surface renders. */
  messages: ChatMessage[];
  /** Is there history BEFORE this page that a scroll-up could reach? */
  hasOlder: boolean;
}

/**
 * Whether a scroll-up from this page could return anything.
 *
 * **A short page means the thread is exhausted — here, and only here.** That
 * inference is the "fewer-than-asked means final" shape this codebase has been
 * bitten by on the NODE surface, where it is genuinely unsafe: that read
 * overfetches (`NODE_OVERFETCH`) and filters client-side, so a short page may
 * be short because rows were dropped, not because the thread ran out. The
 * server's `chatHistory` does no such filtering — its Prisma `take` IS the page
 * (`resolvers.query.chat.ts`), so short can only mean the candidate set was
 * smaller than the window. The distinction is why this is spelled out rather
 * than borrowed: the two surfaces look alike and are not.
 *
 * It has to be inferred at all because `chatHistory` returns a BARE LIST — no
 * `total`, no page wrapper, unlike `teamChatMessages`. (And a `total` would not
 * have helped as much as it looks: the team chat's is cursor-scoped, so a
 * client must keep the one from its tail read anyway.)
 *
 * The second clause is the honest limit. Paging needs a cursor, the cursor is
 * the oldest `seq` on the page, and `ChatMessage.seq` is NULLABLE — messages
 * written before the counter existed carry none. The server orders those as the
 * oldest of the transcript and every cursor reaches them, so they are visible;
 * but a page consisting only of them yields no `seq` to ask again with. Rather
 * than hand the client a cursor of `null` and have it either loop on the same
 * page or quietly re-read the tail, scrollback ends here and says so. Reachable
 * only by a legacy chat holding more than a full page of counterless messages.
 */
export function hasOlderBefore(messages: ChatMessage[], limit: number): boolean {
  if (messages.length < limit) return false;
  return messages[0]?.seq != null;
}

/**
 * The cursor for the page BEFORE this one: the oldest `seq` on screen.
 *
 * Pages are oldest-first, so that is `messages[0]` — not a `Math.min` over the
 * array, and specifically not one over the component's rendered transcript.
 * `AgentChat` fabricates `seq: messages.length` on its optimistic user and
 * assistant bubbles, which for any resumed chat is far LOWER than the real seqs
 * around it. A minimum taken across the rendered array would therefore return
 * the fabricated value and page from a position that never existed, skipping
 * everything between it and the real window. The cursor is kept as state fed
 * only by server pages for exactly this reason.
 */
export function olderCursorFrom(messages: ChatMessage[]): number | null {
  return messages[0]?.seq ?? null;
}
