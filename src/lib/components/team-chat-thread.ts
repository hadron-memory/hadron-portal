import type { TeamChatMessage } from '$lib/types';

/**
 * Presentation logic for the team chat tab (hadron-portal#732), kept out of the
 * Svelte component so the attribution rules — the whole reason the tab exists —
 * are unit-testable without a DOM.
 */

/**
 * Who posted a message.
 *
 * `worker` and `human` are the two live cases, and the server guarantees they
 * are mutually exclusive (`authorUserId` XOR `authorWorkerId` in the envelope,
 * hadron-server#939).
 *
 * `legacy` is the persona-era shape. Before the Worker model (#974/PR #978) a
 * non-human author was stored as `authorAgentId`, and the current
 * `teamChatMessages` resolver reads only `authorWorkerId` — so such a message
 * arrives with BOTH ids null while `authorName` is populated. Verified against
 * this team's own chat: seq 2 stores
 * `{authorName: "Ada", authorAgentId: …, sessionId: …}` and surfaces with no
 * author id at all.
 *
 * Collapsing that into `unknown` would be its own small lie. The record plainly
 * knows who posted — the name is right there, and a `sessionId` means it came
 * through a driving session rather than a browser. What it does not carry is a
 * WORKER id, because no worker row existed yet. So: name it, and do not claim
 * a Worker that does not exist.
 *
 * `unknown` is then reserved for an envelope that really identifies nobody. It
 * is not a kind of author; it is the honest rendering of a record that cannot
 * say. Defaulting it to `human` would be the same class of bug this tab exists
 * to fix — presenting an indistinguishable author as a known one.
 */
export type TeamChatAuthorKind = 'worker' | 'human' | 'legacy' | 'unknown';

export function authorKindOf(
  msg: Pick<TeamChatMessage, 'authorWorkerId' | 'authorUserId' | 'authorName'>,
): TeamChatAuthorKind {
  if (msg.authorWorkerId) return 'worker';
  if (msg.authorUserId) return 'human';
  if (msg.authorName?.trim()) return 'legacy';
  return 'unknown';
}

/**
 * The name to show above a message.
 *
 * `authorName` is denormalized at write time, which is what makes it correct
 * for a RETIRED worker and for pre-#974 records — resolving the id live would
 * lose both. It is nullable in the schema, so a fallback is required; the
 * fallback names the kind rather than inventing a person.
 */
export function authorLabelOf(msg: Pick<TeamChatMessage, 'authorWorkerId' | 'authorUserId' | 'authorName'>): string {
  if (msg.authorName?.trim()) return msg.authorName.trim();
  switch (authorKindOf(msg)) {
    case 'worker':
      return 'Unnamed worker';
    case 'human':
      return 'Unnamed user';
    default:
      // `legacy` is unreachable here — it requires an authorName, which the
      // branch above already returned.
      return 'Unknown author';
  }
}

/** The single letter in the avatar disc. */
export function authorInitialOf(label: string): string {
  const ch = label.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

/**
 * Build a seq → message index so a reply can render a quote of its parent.
 *
 * Keyed on `seq` rather than `nodeId` because `replyToSeq` is what the envelope
 * carries — the server validates it inside the allocating transaction, so a
 * stored `replyToSeq` always named a real message at write time. It may still
 * be absent from THIS page: the transcript is paged and a reply can cite a
 * message older than the window. Callers must treat a miss as "not on screen",
 * never as "does not exist".
 */
export function indexBySeq(messages: readonly TeamChatMessage[]): Map<number, TeamChatMessage> {
  const bySeq = new Map<number, TeamChatMessage>();
  for (const m of messages) bySeq.set(m.seq, m);
  return bySeq;
}

/** A one-line quote of the cited message, for the reply header. */
export function replyPreviewOf(
  msg: Pick<TeamChatMessage, 'replyToSeq'>,
  bySeq: Map<number, TeamChatMessage>,
  maxChars = 80,
): { seq: number; author: string; excerpt: string } | null {
  if (msg.replyToSeq == null) return null;
  const parent = bySeq.get(msg.replyToSeq);
  // Off-page parent: still tell the reader which seq is being answered. The
  // number is the useful half — it is how teammates cite each other.
  if (!parent) return { seq: msg.replyToSeq, author: '', excerpt: '' };
  const flat = parent.body.replace(/\s+/g, ' ').trim();
  return {
    seq: msg.replyToSeq,
    author: authorLabelOf(parent),
    excerpt: flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat,
  };
}

/**
 * Stable avatar colour per author.
 *
 * Keyed on the author LABEL rather than the id so a worker and a human with the
 * same display name cannot collide into one colour by accident of ordering —
 * and so the colour survives paging, where the set of ids on screen changes but
 * the names do not.
 */
const AVATAR_COLORS = [
  'bg-indigo-500',
  'bg-teal-600',
  'bg-amber-600',
  'bg-rose-500',
  'bg-sky-600',
  'bg-violet-500',
] as const;

export function avatarColorOf(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
