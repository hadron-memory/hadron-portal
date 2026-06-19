import { CANONICAL_SCHEME, parseUrn, UrnParseError } from '$lib/urn/parse-urn';

/**
 * #337 — header command bar logic. The bar is a single input: the user types a
 * command word (`open`, `search`, `create`) which inline-autocompletes, then a
 * space, then the argument — e.g. `open hrn:node:acme::docs::intro`. Submitting
 * splits the text into (command, argument) via {@link parseCommandInput} and
 * dispatches {@link buildCommandRoute}, which navigates to the returned path.
 * (Replaces the #320 mode dropdown.)
 *
 * Modes are a REGISTRY, not a hardcoded switch — adding "invite", "clone", …
 * later is a new {@link COMMAND_MODES} entry plus a case in
 * {@link buildCommandRoute}; the component doesn't change. The `id` IS the typed
 * command word. The input parsing/completion logic lives here (a pure module)
 * so it's unit-testable; the component owns only focus state + caret juggling +
 * the fetch wiring (vitest here has no DOM — see the svelte-component-test-gap
 * convention).
 */
export type CommandModeId = 'open' | 'search' | 'create';

/**
 * Semantic activation color per command — the "command ↔ color" register. Once
 * a command word is recognized the bar tints to its color so the user can see
 * at a glance what they're about to do (blue = just viewing, green = creating,
 * …). Only the token lives here; the component maps it to theme-aware Tailwind
 * classes, so this module stays pure and styling-free.
 */
export type CommandTint = 'blue' | 'violet' | 'emerald';

export interface CommandMode {
  /** The command word the user types; also the canonical completion target. */
  id: CommandModeId;
  /** Activation color (see {@link CommandTint}); tints the bar once recognized. */
  tint: CommandTint;
  /** [i18n key, English default] hint for the argument, shown once the command
   *  word is locked in (a trailing space exists) and the argument is empty. */
  argHint: [string, string];
}

export const COMMAND_MODES: CommandMode[] = [
  { id: 'open', tint: 'blue', argHint: ['app.commandbar.arghint.open', 'Open by URN…'] },
  { id: 'search', tint: 'violet', argHint: ['app.commandbar.arghint.search', 'Search by name, URN, or id…'] },
  { id: 'create', tint: 'emerald', argHint: ['app.commandbar.arghint.create', 'Create from a new URN…'] },
];

/**
 * The command word currently being typed → its unique completion. Returns the
 * matched mode `id` + the remaining suffix (the inline "ghost" text);
 * `completion` is '' when `token` already equals an id. null when the token is
 * empty, matches nothing, or is an ambiguous prefix of more than one command.
 * Case-insensitive; an exact id match always wins over a longer prefix sibling.
 */
export function completeCommand(token: string): { id: CommandModeId; completion: string } | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const exact = COMMAND_MODES.find((m) => m.id === t);
  if (exact) return { id: exact.id, completion: '' };
  const matches = COMMAND_MODES.filter((m) => m.id.startsWith(t));
  if (matches.length !== 1) return null;
  return { id: matches[0].id, completion: matches[0].id.slice(t.length) };
}

/**
 * Accept the inline completion for the command word being typed: returns
 * `"<command> "` (canonical id + one trailing space, ready for the argument), or
 * null when there's nothing to accept — the input already contains a space (the
 * command word is locked in) or the token doesn't uniquely complete.
 */
export function acceptCompletion(raw: string): string | null {
  const s = raw.replace(/^\s+/, '');
  if (/\s/.test(s)) return null; // a separator space exists → command word locked
  const c = completeCommand(s);
  return c ? `${c.id} ` : null;
}

/**
 * Split raw input into command word + argument. The command is the first
 * whitespace-delimited token; the argument is everything after the first run of
 * whitespace, with its own internal spaces preserved (e.g. a search phrase).
 * `mode` is null when the token isn't exactly a command id — i.e. the
 * still-typing / unknown-command state.
 */
export function parseCommandInput(raw: string): {
  mode: CommandModeId | null;
  token: string;
  arg: string;
} {
  const s = raw.replace(/^\s+/, '');
  const sep = /\s/.exec(s);
  const token = sep ? s.slice(0, sep.index) : s;
  const arg = sep ? s.slice(sep.index).replace(/^\s+/, '') : '';
  const mode = COMMAND_MODES.find((m) => m.id === token.toLowerCase())?.id ?? null;
  return { mode, token, arg };
}

/** Shape returned by `resolveUrn` (mirrors the GraphQL query + #262 route). */
export interface UrnResolution {
  kind: 'memory' | 'node' | 'agent' | 'org' | 'app';
  id: string;
  memoryId: string | null;
  organizationId: string | null;
}

/**
 * Resolves a URN to its PK resolution (or null when unresolvable / no access).
 * Injected so the routing logic stays pure and testable; the component passes
 * a fn that GETs `/app/u/resolve`.
 */
export type ResolveFn = (urn: string) => Promise<UrnResolution | null>;

export type CommandRoute = { ok: true; path: string } | { ok: false; error: string };

/**
 * Map (mode, raw input) → a portal path to navigate to, or an error string to
 * show inline. `resolve` is only consulted for Create sub-routing that needs a
 * parent PK (memory/agent → org, node → memory).
 */
export async function buildCommandRoute(
  mode: CommandModeId,
  rawValue: string,
  resolve: ResolveFn,
): Promise<CommandRoute> {
  const value = rawValue.trim();
  if (!value) return { ok: false, error: 'Enter a value.' };

  switch (mode) {
    case 'search':
      return { ok: true, path: `/app/search?q=${encodeURIComponent(value)}` };

    case 'open':
      // URN-only (per #320 decision): hand the raw URN to the `/app/u/[urn]`
      // resolver, which 307-redirects to the canonical page and 404s on bad or
      // no-access input. The URN grammar yields only `:` + path-safe atoms, so
      // it rides one path segment un-encoded (see resource-share-links).
      return { ok: true, path: `/app/u/${value}` };

    case 'create':
      return buildCreateRoute(value, resolve);
  }
}

/** Create-mode sub-router: parse the URN, dispatch on its kind. */
async function buildCreateRoute(value: string, resolve: ResolveFn): Promise<CommandRoute> {
  let parsed;
  try {
    parsed = parseUrn(value);
  } catch (e) {
    return { ok: false, error: e instanceof UrnParseError ? e.message : 'Not a valid URN.' };
  }

  const segments = parsed.pathSegments;
  const ownSlug = segments[segments.length - 1];

  switch (parsed.type) {
    case 'org':
      // Org create takes a bare slug in its `urn` field; the org URN is a
      // single atom (`hrn:org:<slug>`). No parent to resolve.
      return { ok: true, path: `/app/orgs/new?urn=${encodeURIComponent(segments[0])}` };

    case 'memory': {
      const org = await resolveParentOrg(segments, resolve);
      if (!org.ok) return org;
      return { ok: true, path: `/app/orgs/${org.id}/memories/new?slug=${encodeURIComponent(ownSlug)}` };
    }

    case 'agent': {
      const org = await resolveParentOrg(segments, resolve);
      if (!org.ok) return org;
      return { ok: true, path: `/app/orgs/${org.id}/agents/new?slug=${encodeURIComponent(ownSlug)}` };
    }

    case 'node': {
      // Node URN = hrn:node:<memory-path>::<loc>. The loc is the last
      // `::`-segment (locs keep their internal single `:`); the rest is the
      // memory's slug-path (see composeNodeUrn).
      if (segments.length < 2) {
        return { ok: false, error: 'Node URN is missing its memory path.' };
      }
      const memoryPath = segments.slice(0, -1).join('::');
      const res = await resolve(`${CANONICAL_SCHEME}:memory:${memoryPath}`);
      if (!res || res.kind !== 'memory') {
        return { ok: false, error: `Couldn't find the memory for this node URN, or you lack access.` };
      }
      return { ok: true, path: `/app/memories/${res.id}/nodes/new?loc=${encodeURIComponent(ownSlug)}` };
    }

    case 'app':
      // Spec 009 retired the standalone "create app" route — Apps are created
      // only by installing an Agent. There's no create-from-URN form, so send
      // the user to the org list to pick an org and install an Agent.
      return { ok: true, path: '/app/orgs' };

    default:
      return { ok: false, error: `Don't know how to create a "${parsed.type}".` };
  }
}

/** Resolve the org that owns a memory/agent URN (its first path segment). */
async function resolveParentOrg(
  segments: string[],
  resolve: ResolveFn,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const orgSlug = segments[0];
  if (!orgSlug || segments.length < 2) {
    return { ok: false, error: 'URN is missing its organization segment.' };
  }
  const res = await resolve(`${CANONICAL_SCHEME}:org:${orgSlug}`);
  if (!res || res.kind !== 'org') {
    return { ok: false, error: `Couldn't find organization "${orgSlug}", or you lack access.` };
  }
  return { ok: true, id: res.id };
}
