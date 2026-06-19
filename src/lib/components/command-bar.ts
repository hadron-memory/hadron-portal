import { CANONICAL_SCHEME, parseUrn, UrnParseError } from '$lib/urn/parse-urn';

/**
 * #320 — header command bar logic. The bar is one fused control: a mode
 * dropdown on the left + an input on the right. Picking a mode swaps the
 * placeholder; hitting Enter dispatches `buildCommandRoute` for the mode and
 * navigates to the returned path.
 *
 * Modes are a REGISTRY, not a hardcoded switch — adding "Invite user",
 * "Clone memory", … later is a new {@link COMMAND_MODES} entry plus a case in
 * {@link buildCommandRoute}, nothing in the component changes. The routing
 * logic lives here (a pure module) so it's unit-testable; the component owns
 * only focus state + the fetch wiring (vitest here has no DOM — see the
 * svelte-component-test-gap convention).
 */
export type CommandModeId = 'open' | 'search' | 'create';

export interface CommandMode {
  id: CommandModeId;
  /** [i18n key, English default] for the dropdown label. */
  label: [string, string];
  /** [i18n key, English default] for the input placeholder. */
  placeholder: [string, string];
}

export const COMMAND_MODES: CommandMode[] = [
  {
    id: 'open',
    label: ['app.commandbar.mode.open', 'Open'],
    placeholder: ['app.commandbar.placeholder.open', 'Open by URN…'],
  },
  {
    id: 'search',
    label: ['app.commandbar.mode.search', 'Search'],
    placeholder: ['app.commandbar.placeholder.search', 'Search by name, URN, or id…'],
  },
  {
    id: 'create',
    label: ['app.commandbar.mode.create', 'Create'],
    placeholder: ['app.commandbar.placeholder.create', 'Create from a new URN…'],
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
