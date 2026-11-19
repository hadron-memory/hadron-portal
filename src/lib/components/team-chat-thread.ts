import type { TeamChatFilter } from '$lib/team-chat-filter';
import type { TeamChatMessage } from '$lib/types';

/**
 * Ephemeral user intent, owned outside a route-keyed thread mount. Never persisted.
 *
 * #2250 round 5 (Gil N5): renamed from `TeamChatFilterFocusRequest` — focus is
 * one of the things it carries (opener, movedFocus), not what it is. It is the
 * record of one in-flight filter REQUEST: what was asked, what it replaces, and
 * how the route's read resolved.
 */
export interface TeamChatFilterRequest {
  key: string;
  label?: string;
  /**
   * The head id this request ADDED to the selection, when it added one. The
   * label above is that head's clicked tag label; on a removal it is the
   * departing head's label and must never announce as the active filter.
   */
  addedHead?: string;
  /**
   * #2250 fix round: the head id this request REMOVED, when it removed exactly
   * one (a chip or row-tag toggle-out). With several chips, focus must land on
   * the removed chip's neighbour, not on chip 1.
   */
  removedHead?: string;
  /**
   * The selection order the removal's neighbour is picked from — the base the
   * toggle computed against, not the (possibly stale) applied prop.
   */
  baseHeadRefs: readonly string[];
  /**
   * #2250 fix round: the selection this request asked for. While the route's
   * read is still pending, a FURTHER toggle computes against this requested
   * set — the applied `filter` prop still shows the pre-click selection and
   * would silently drop every head chosen since the read started.
   */
  pendingFilter: TeamChatFilter;
  opener: Element | null;
  /** The route owner marks its own goto; absent for synchronous component consumers. */
  navigation?: 'pending' | 'complete';
  /** Reader intent survives destruction of the focused old thread control. */
  movedFocus?: 'composer' | 'elsewhere';
}

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

/**
 * Where an author's name links to, or null when there is nowhere to go.
 *
 * The four author kinds already encode exactly this, which is why the rule
 * lives here rather than as a second guess in the template: `worker` and
 * `human` are the two that carry an id, and an id is what both profile routes
 * resolve (`worker(ref:)` and `user(ref:)` each take an id, a name/handle or a
 * URN). `legacy` and `unknown` carry NO id by definition — that is their whole
 * meaning — so they must render as plain text.
 *
 * Linking them anyway is the failure to avoid, and it would be easy: a `legacy`
 * message has a perfectly good `authorName`, so a name-based guess would
 * produce a link that looks right and resolves to whoever holds that name
 * TODAY. The pre-worker author and the current holder of the name are not the
 * same entity, and the point of the `legacy` kind is to stop claiming they are.
 *
 * Returns the worker route for a worker — not the agent's. A Worker is the
 * named casting an agent was cast into, and it is the worker that posted; its
 * page carries the role, the holder and the sessions, and links on to the Agent
 * for anyone who wants the template behind it.
 */
export function authorHrefOf(
  msg: Pick<TeamChatMessage, 'authorWorkerId' | 'authorUserId' | 'authorName'>,
): string | null {
  switch (authorKindOf(msg)) {
    case 'worker':
      return `/app/workers/${encodeURIComponent(msg.authorWorkerId as string)}`;
    case 'human':
      return `/app/user/${encodeURIComponent(msg.authorUserId as string)}`;
    default:
      return null;
  }
}

/**
 * #855 — the author's canonical address, or null when there is none to show.
 *
 * Only a `worker` author has one here: the envelope carries its id, and the
 * App page already loads the staff roster (`WorkerFields.urn`), retired workers
 * included, so the join needs no new fetch. Null when:
 * - the author is not a worker: a human's URN is not in this payload, and a
 *   `legacy` / `unknown` author has no id at all (see `authorHrefOf`);
 * - the roster failed to load (the caller passes null);
 * - the worker's URN is null, which `Worker.urn` is by contract when the App's
 *   URN predates the flat grammar-v2 arity.
 * Absent, never an empty chip (AGENTS.md: a referenced object shows its URN).
 *
 * The MESSAGE's own URN needs hadron-server#1209 (`TeamChatMessage.urn`); the
 * slot this fills is built to hold that chip beside this one.
 */
export function authorUrnOf(
  msg: Pick<TeamChatMessage, 'authorWorkerId' | 'authorUserId' | 'authorName'>,
  workerUrns: ReadonlyMap<string, string> | null | undefined,
): string | null {
  if (authorKindOf(msg) !== 'worker' || !workerUrns) return null;
  return workerUrns.get(msg.authorWorkerId as string) || null;
}

/**
 * #855 (@codex on #908): worker ids in `items` that the roster has never seen —
 * a worker cast after the page loaded. Only these warrant re-reading the
 * roster; a KNOWN worker whose URN is null would not gain one by asking again.
 * Deduplicated, in first-seen order.
 */
export function unknownWorkerIds(
  items: Array<Pick<TeamChatMessage, 'authorWorkerId'>>,
  knownIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const m of items) {
    const id = m.authorWorkerId;
    if (id && !knownIds.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
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
 * The LOCAL calendar day a timestamp falls on, as `YYYY-MM-DD`; null when the
 * string is not a date.
 *
 * Local, not UTC, because a separator saying "Thursday" must agree with the
 * clock on the reader's wall — a message posted at 23:30 their time is that
 * day's, whatever UTC says. That also means the partition is only knowable in
 * the browser; the component renders separators after mount for that reason.
 */
export function dayKeyOf(at: string): string | null {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : dayKeyOfDate(d);
}

function dayKeyOfDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type DayLabel = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; label: string };

export interface AnnotatedMessage {
  msg: TeamChatMessage;
  /** Set on the first message of each day — the separator above it. */
  day: DayLabel | null;
  /** The time cell: hours and minutes, or the raw string when unparseable. */
  time: string;
}

// Built once: `toLocale*String` with an options object constructs a formatter
// per call, and a thread renders hundreds of these.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const DAY_FORMAT_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * The thread's rows with their day separators and time cells decided in ONE
 * pass over the list — a partition is a property of the list, not of a row.
 *
 * The first parseable message opens a day, and so does every message whose
 * local calendar day differs from the previous parseable one. An unparseable
 * timestamp neither opens nor closes a day: compared as a plain value it would
 * insert a blank separator on either side of the bad row, which is a rendering
 * of the defect rather than a disclosure of it — its own time cell shows the
 * raw string, and that is the disclosure.
 *
 * `today` and `yesterday` come back as KINDS so the component can localize
 * them through `t()`; a dated label is formatted here because it is the
 * platform's locale formatting, not copy. The year is shown only when it is
 * not the current one — a thread is read in the present.
 *
 * `now` is null on the server: the partition is a LOCAL-calendar fact, so it
 * is only knowable in the browser, and rows are emitted without separators
 * until it is. Passing the clock in also makes the labels a pure function of
 * their inputs, and re-running the pass whenever the list changes is what
 * keeps a thread left open across midnight from showing two "Today"s.
 */
export function annotateDays(messages: readonly TeamChatMessage[], now: Date | null): AnnotatedMessage[] {
  const todayKey = now ? dayKeyOfDate(now) : null;
  let yesterdayKey: string | null = null;
  if (now) {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    yesterdayKey = dayKeyOfDate(y);
  }
  let prevKey: string | null = null;
  return messages.map((msg) => {
    const d = new Date(msg.at);
    const valid = !Number.isNaN(d.getTime());
    const time = valid ? TIME_FORMAT.format(d) : msg.at;
    let day: DayLabel | null = null;
    if (now && valid) {
      const key = dayKeyOfDate(d);
      if (key !== prevKey) {
        if (key === todayKey) day = { kind: 'today' };
        else if (key === yesterdayKey) day = { kind: 'yesterday' };
        else {
          const sameYear = d.getFullYear() === now.getFullYear();
          day = { kind: 'date', label: (sameYear ? DAY_FORMAT : DAY_FORMAT_WITH_YEAR).format(d) };
        }
      }
      prevKey = key;
    }
    return { msg, day, time };
  });
}

/**
 * Does a clamped message body hide anything? Measured, not guessed from the
 * body length: a 400-character message with a table can overflow the clamp
 * while a 2,000-character one of short lines fits. The one-pixel tolerance
 * absorbs sub-pixel rounding, which otherwise reports a body that fits exactly
 * as overflowing and offers a "Show more" that reveals nothing.
 */
export function bodyOverflows(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > 1;
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
