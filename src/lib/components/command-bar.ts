import { CANONICAL_SCHEME, parseUrn, UrnParseError } from '$lib/urn/parse-urn';
import { openUrnCandidates } from '$lib/urn/open-urn-candidates';

/**
 * #337/#339 — header command bar logic. The bar is a single input that behaves
 * like a command palette: as the user types, a dropdown lists matching commands
 * ({@link parseCommand}); choosing one either runs it (no-argument commands) or
 * completes to `"<command> "` so the user can type its argument. Submitting
 * dispatches {@link resolveCommandAction}, which returns a navigation, an
 * external redirect, an org-switch popup, or an inline error.
 *
 * Commands are a REGISTRY ({@link COMMANDS}); each carries its trigger phrases
 * (incl. aliases + multi-word names), a color tint, and an optional argument
 * spec. The URN trio (open/search/create) still routes through the pure,
 * unit-tested {@link buildCommandRoute}; everything else resolves here. All
 * parsing/dispatch is pure so it's testable without a DOM (see the
 * svelte-component-test-gap convention) — the component owns focus, the
 * dropdown, caret juggling, and the resolve fetch.
 */

/** Activation color per command — the "command ↔ color" register (semantic:
 *  blue = view/open, violet = search, emerald = add, amber = switch, rose =
 *  leave). The component maps each token to theme-aware Tailwind classes. */
export type CommandTint = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';

/** The argument a command takes after its trigger word. */
export interface CommandArg {
  kind: 'urn' | 'query' | 'email';
  /** Muted hint shown once the command is locked in and the argument is empty. */
  hint: string;
  /** When true the command may run with an empty argument (invite → open form). */
  optional?: boolean;
}

export interface CommandSpec {
  /** Stable unique id (kebab-case). */
  id: string;
  /** Human title for the dropdown row. */
  title: string;
  /** Lowercase phrases the user can type; `triggers[0]` is canonical (the
   *  completion target). Later entries are aliases, including multi-word ones. */
  triggers: string[];
  /** One-line description for the dropdown row. */
  desc: string;
  tint: CommandTint;
  /** Argument spec, or null for a no-argument command. */
  arg: CommandArg | null;
}

export const COMMANDS: CommandSpec[] = [
  // — view / open (blue) —
  {
    id: 'open',
    title: 'Open',
    triggers: ['open'],
    desc: 'Open a resource by URN',
    tint: 'blue',
    arg: { kind: 'urn', hint: 'Open by URN…' },
  },
  {
    id: 'org',
    title: 'Organization',
    triggers: ['org', 'organization', 'dashboard'],
    desc: 'Go to the active organization',
    tint: 'blue',
    arg: null,
  },
  { id: 'team', title: 'Team', triggers: ['team'], desc: 'Members of the active org', tint: 'blue', arg: null },
  { id: 'memories', title: 'Memories', triggers: ['memories'], desc: 'Memories in the active org', tint: 'blue', arg: null },
  { id: 'agents', title: 'Agents', triggers: ['agents'], desc: 'Agents in the active org', tint: 'blue', arg: null },
  { id: 'apps', title: 'Apps', triggers: ['apps'], desc: 'Apps in the active org', tint: 'blue', arg: null },
  { id: 'account', title: 'Account', triggers: ['account'], desc: 'Your account settings', tint: 'blue', arg: null },
  {
    id: 'app-keys',
    title: 'App keys',
    triggers: ['app keys', 'keys'],
    desc: 'Your API / app keys',
    tint: 'blue',
    arg: null,
  },
  {
    // #375 — opens the "Check access" command page (a form, since the check
    // takes two arguments the inline bar can't express).
    id: 'access-check',
    title: 'Check access',
    triggers: ['access check', 'check access'],
    desc: "Check a user's access to a resource",
    tint: 'blue',
    arg: null,
  },
  {
    // #395 — opens the "Merge node" command page (folds one node into another).
    id: 'merge-node',
    title: 'Merge node',
    triggers: ['merge node', 'merge'],
    desc: 'Fold one node into another',
    tint: 'emerald',
    arg: null,
  },
  {
    // #396 — opens the "Merge memory" command page (empties one memory into another).
    id: 'merge-memory',
    title: 'Merge memory',
    triggers: ['merge memory'],
    desc: 'Empty one memory into another',
    tint: 'emerald',
    arg: null,
  },
  // — search (violet) —
  {
    id: 'search',
    title: 'Search',
    triggers: ['search', 'find'],
    desc: 'Global search',
    tint: 'violet',
    arg: { kind: 'query', hint: 'Search by name, URN, or id…' },
  },
  // — add / create (emerald) —
  {
    id: 'create',
    title: 'Create',
    triggers: ['create'],
    desc: 'Create a resource from a URN',
    tint: 'emerald',
    arg: { kind: 'urn', hint: 'Create from a new URN…' },
  },
  {
    id: 'invite',
    title: 'Invite',
    triggers: ['invite'],
    desc: 'Invite someone by email',
    tint: 'emerald',
    arg: { kind: 'email', hint: 'Email to invite…', optional: true },
  },
  // — switch (amber) —
  {
    id: 'switch',
    title: 'Switch org',
    triggers: ['switch', 'switch org', 'switch organization'],
    desc: 'Switch the active organization',
    tint: 'amber',
    arg: null,
  },
  // — leave (rose) —
  {
    id: 'sign-out',
    title: 'Sign out',
    triggers: ['sign out', 'signout', 'logout', 'log out'],
    desc: 'Sign out of Hadron',
    tint: 'rose',
    arg: null,
  },
];

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

// ── Palette parsing ─────────────────────────────────────────────────────────

export interface ParsedCommand {
  /** 'selecting' = still choosing the command word (dropdown showing);
   *  'arg' = a command that takes an argument is locked in, typing the arg. */
  phase: 'selecting' | 'arg';
  /** The command: exact match in 'selecting', or the locked command in 'arg'. */
  command: CommandSpec | null;
  /** The argument text (arg phase only; inner spaces preserved). */
  arg: string;
  /** Dropdown candidates whose trigger has the typed text as a prefix
   *  (selecting phase; the full list when input is empty). */
  matches: CommandSpec[];
}

/**
 * Parse raw input into the current palette state. A command "locks in" (arg
 * phase) when the input continues past one of an argument-taking command's
 * triggers with a space — e.g. `open hrn:…`, `search a b`, `invite x@y`; the
 * longest such trigger wins (so multi-word triggers beat their prefixes).
 * Otherwise we're still selecting: `matches` are the commands whose trigger
 * starts with the typed text (the whole input, spaces and all, so multi-word
 * triggers like "app keys" filter correctly).
 */
export function parseCommand(raw: string): ParsedCommand {
  const s = raw.replace(/^\s+/, '');
  const lower = s.toLowerCase();

  let best: { command: CommandSpec; trig: string } | null = null;
  for (const c of COMMANDS) {
    if (!c.arg) continue;
    for (const trig of c.triggers) {
      if (lower.startsWith(`${trig} `) && (!best || trig.length > best.trig.length)) {
        best = { command: c, trig };
      }
    }
  }
  if (best) {
    return {
      phase: 'arg',
      command: best.command,
      arg: s.slice(best.trig.length).replace(/^\s+/, ''),
      matches: [],
    };
  }

  const q = lower.trim();
  const matches = q === '' ? COMMANDS.slice() : COMMANDS.filter((c) => c.triggers.some((t) => t.startsWith(q)));
  const command = COMMANDS.find((c) => c.triggers.includes(q)) ?? null;
  return { phase: 'selecting', command, arg: '', matches };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export type CommandAction =
  | { type: 'navigate'; path: string } // client-side goto
  | { type: 'external'; url: string } // full-page navigation (e.g. sign out)
  | { type: 'switch' } // open the org-switch popup
  | { type: 'error'; message: string };

export interface CommandContext {
  /** PK of the active org, for `/app/orgs/<pk>/…` routes (null → personal/none). */
  activeOrgId: string | null;
  resolve: ResolveFn;
}

/** Map a chosen command + argument to the action the component should perform. */
export async function resolveCommandAction(
  command: CommandSpec,
  arg: string,
  ctx: CommandContext,
): Promise<CommandAction> {
  const org = (suffix: string): CommandAction => {
    if (ctx.activeOrgId) return { type: 'navigate', path: `/app/orgs/${ctx.activeOrgId}${suffix}` };
    // No active org PK: the bare org page has a redirector; sub-pages don't.
    if (suffix === '') return { type: 'navigate', path: '/app/dashboard' };
    return { type: 'error', message: 'No active organization yet.' };
  };

  switch (command.id) {
    case 'open':
    case 'search':
    case 'create': {
      const r = await buildCommandRoute(command.id, arg, ctx.resolve);
      return r.ok ? { type: 'navigate', path: r.path } : { type: 'error', message: r.error };
    }
    case 'org':
      return org('');
    case 'team':
      return org('/members');
    case 'memories':
      return org('/memories');
    case 'agents':
      return org('/agents');
    case 'apps':
      return org('/apps');
    case 'account':
      return { type: 'navigate', path: '/app/account' };
    case 'app-keys':
      return { type: 'navigate', path: '/app/account/api-keys' };
    case 'access-check':
      return { type: 'navigate', path: '/app/commands/access-check' };
    case 'merge-node':
      return { type: 'navigate', path: '/app/commands/merge-node' };
    case 'merge-memory':
      return { type: 'navigate', path: '/app/commands/merge-memory' };
    case 'invite': {
      const email = arg.trim();
      return { type: 'navigate', path: `/app/account/invite${email ? `?email=${encodeURIComponent(email)}` : ''}` };
    }
    case 'switch':
      return { type: 'switch' };
    case 'sign-out':
      return { type: 'external', url: '/auth/signout' };
    default:
      return { type: 'error', message: `Don't know how to run "${command.title}".` };
  }
}

// ── URN routing (open / search / create) — pure + unit-tested ────────────────

export type CommandModeId = 'open' | 'search' | 'create';

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
      return buildOpenRoute(value, resolve);

    case 'create':
      return buildCreateRoute(value, resolve);
  }
}

/**
 * Open-mode sub-router (#567): qualify the raw input into canonical URN
 * candidates before handing one to the `/app/u/[urn]` resolver, which
 * 307-redirects to the canonical page. Users paste bare hierarchy paths
 * (`acme.com::docs::intro`) at least as often as canonical `hrn:` URNs, and
 * the server-side resolver only dispatches on a scheme-prefixed URN — so the
 * old pass-through dead-ended every bare paste.
 *
 * A single candidate navigates directly (the resolver route is the access
 * check). With several candidates (a bare path's kind is ambiguous), each is
 * probed via `resolve` and the first hit wins; when none resolve, we still
 * navigate to the best guess so the not-found page shows the qualified URN
 * the user can correct. The URN grammar yields only `:` + path-safe atoms, so
 * a candidate rides one path segment un-encoded (see resource-share-links).
 */
async function buildOpenRoute(value: string, resolve: ResolveFn): Promise<CommandRoute> {
  const candidates = openUrnCandidates(value);
  if (candidates.length === 0) {
    return { ok: false, error: 'Not a valid URN.' };
  }
  if (candidates.length > 1) {
    for (const urn of candidates) {
      if (await resolve(urn)) return { ok: true, path: `/app/u/${urn}` };
    }
  }
  return { ok: true, path: `/app/u/${candidates[0]}` };
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
      return { ok: true, path: `/app/orgs/new?urn=${encodeURIComponent(segments[0])}` };

    case 'memory': {
      const orgRes = await resolveParentOrg(segments, resolve);
      if (!orgRes.ok) return orgRes;
      return { ok: true, path: `/app/orgs/${orgRes.id}/memories/new?slug=${encodeURIComponent(ownSlug)}` };
    }

    case 'agent': {
      const orgRes = await resolveParentOrg(segments, resolve);
      if (!orgRes.ok) return orgRes;
      return { ok: true, path: `/app/orgs/${orgRes.id}/agents/new?slug=${encodeURIComponent(ownSlug)}` };
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
