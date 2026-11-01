import { t } from '$lib/i18n/t';
import { composeUrnV2, parseUrnV2 } from '$lib/urn/parse-urn';
import { sameAppTaskHandle, taskHref } from './handle';
import { sourceKind } from './status';

/**
 * portal#1575 — a task's typed references (hadron-server#2649/#3112;
 * hrn:node:hadronmemory.com:specs:cor:agt:050:01 References, :09 Editing).
 *
 * A reference is `{kind, target, label?}`, kept in order. The server stores the
 * target and label EXACTLY as given and never resolves them: bidi and format
 * characters, userinfo, IDNA hosts and upper-case schemes are all accepted
 * (the §10 note on #3112). So everything that draws one goes through here:
 *
 *   - `neutralizeFormatChars` for what a reader SEES of a target or a label;
 *   - `referenceLink` for whether it is a link at all, and to where. The
 *     `href` is always the stored string exactly, or a portal route built from
 *     a parsed handle; nothing is fetched or previewed.
 */
export const REFERENCE_KINDS = ['ISSUE', 'PULL_REQUEST', 'NODE', 'TASK', 'URL'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export interface TaskReference {
  kind: ReferenceKind;
  target: string;
  label: string | null;
}

/** The server's caps (#3112). The server stays the authority; the form only stops typing past them. */
export const MAX_REFERENCES = 20;
export const MAX_TARGET_LENGTH = 512;
export const MAX_LABEL_LENGTH = 120;

const isKind = (k: unknown): k is ReferenceKind => typeof k === 'string' && (REFERENCE_KINDS as readonly string[]).includes(k);

export function referenceKindLabel(kind: ReferenceKind): string {
  switch (kind) {
    case 'ISSUE':
      return t('app.tasks.ref.kind.issue', 'Issue');
    case 'PULL_REQUEST':
      return t('app.tasks.ref.kind.pull-request', 'Pull request');
    case 'NODE':
      return t('app.tasks.ref.kind.node', 'Node');
    case 'TASK':
      return t('app.tasks.ref.kind.task', 'Task');
    case 'URL':
      return t('app.tasks.ref.kind.url', 'Link');
  }
}

/**
 * Unicode format characters (`\p{Cf}`: the bidi embeddings, overrides and
 * isolates U+202A–202E and U+2066–2069, the zero-width and directional marks
 * U+200B–200F, the BOM, the soft hyphen…) shown as a visible `[U+XXXX]`
 * instead of obeyed, so a stored string can't reorder or hide what a reader
 * sees. Display only: what is stored, sent and linked is never touched.
 */
export function neutralizeFormatChars(s: string): string {
  return s.replace(/\p{Cf}/gu, (c) => `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`);
}

const FORMAT_CHAR = /\p{Cf}/u;

/** A node URN, exactly: `hrn:node:…` that parses as one and spells itself (the NODE field's shape check). */
export function isNodeUrn(value: string): boolean {
  if (!value.startsWith('hrn:node:') || /\s/.test(value) || FORMAT_CHAR.test(value)) return false;
  return canonicalUrnType(value) === 'node';
}

/** The URN's type when it parses AND recomposes to exactly the same string, else null. */
function canonicalUrnType(value: string): string | null {
  try {
    const p = parseUrnV2(value);
    // The same recomposition Urn.svelte draws and links.
    const urn = composeUrnV2(p.type, p.root, ...p.segments);
    const back = p.fragment ? `${urn}#${p.fragment}` : urn;
    return back === value ? p.type : null;
  } catch {
    return null;
  }
}

/** The URN types `/app/u` resolves (see `Urn.svelte`'s `linked`). `agenttask` is NOT one (Patrick's ruling on #1575). */
const RESOLVABLE = new Set(['mem', 'node', 'org', 'agent', 'app', 'user', 'worker', 'action']);

export type ReferenceLink =
  | { kind: 'href'; href: string; external: boolean }
  | { kind: 'urn'; urn: string; linked: boolean }
  | { kind: 'text' };

/**
 * How one reference is drawn. There is one link rule, `sourceKind`'s, with one
 * exception decided by the KIND first:
 *
 *   - TASK: a qualified handle of THIS App links to its task page
 *     (`/app/apps/<appId>/tasks/<handle>`, which resolves handles, portal#1349);
 *     anything else is text. Never `/app/u`, which resolves no agent-task URN.
 *   - otherwise an http(s) target is an external link whose href is the stored
 *     string exactly; an `hrn:` target is a URN chip when it parses to exactly
 *     itself and holds no format character (the chip draws and links the
 *     recomposed URN, so anything else would show or open something other than
 *     what is stored), linked only for a type the resolver handles; an
 *     `hrn:agenttask` target is text; everything else, `javascript:` and
 *     `data:` included, is text.
 */
export function referenceLink(ref: TaskReference, app: { id: string; urn: string }): ReferenceLink {
  if (ref.kind === 'TASK') {
    const handle = sameAppTaskHandle(ref.target, app.urn);
    return handle ? { kind: 'href', href: taskHref(`/app/apps/${encodeURIComponent(app.id)}`, { id: handle, handle }), external: false } : { kind: 'text' };
  }
  switch (sourceKind(ref.target)) {
    case 'url':
      // sourceKind trims; a target with surrounding whitespace isn't the URL it looks like.
      return ref.target.trim() === ref.target ? { kind: 'href', href: ref.target, external: true } : { kind: 'text' };
    case 'urn': {
      if (FORMAT_CHAR.test(ref.target)) return { kind: 'text' };
      const type = canonicalUrnType(ref.target);
      if (!type || type === 'agenttask') return { kind: 'text' };
      return { kind: 'urn', urn: ref.target, linked: RESOLVABLE.has(type) };
    }
    default:
      return { kind: 'text' };
  }
}

/**
 * The list a form posted (one JSON field), or null when it isn't one, never a
 * silent empty list. Targets are kept exactly; an empty label is no label.
 * Lengths and counts are the server's to refuse (BAD_USER_INPUT, naming the
 * position).
 */
export function readReferences(raw: FormDataEntryValue | string | null | undefined): TaskReference[] | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: TaskReference[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const { kind, target, label } = item as Record<string, unknown>;
    if (!isKind(kind) || typeof target !== 'string') return null;
    if (label !== undefined && label !== null && typeof label !== 'string') return null;
    out.push({ kind, target, label: typeof label === 'string' && label !== '' ? label : null });
  }
  return out;
}

export function sameReferences(a: readonly TaskReference[], b: readonly TaskReference[]): boolean {
  return a.length === b.length && a.every((r, i) => r.kind === b[i]!.kind && r.target === b[i]!.target && (r.label ?? null) === (b[i]!.label ?? null));
}

/** What the server's `AgentTaskReferenceInput` takes: no label key when there is none. */
export function referenceInput(r: TaskReference): { kind: ReferenceKind; target: string; label?: string } {
  return r.label ? { kind: r.kind, target: r.target, label: r.label } : { kind: r.kind, target: r.target };
}
