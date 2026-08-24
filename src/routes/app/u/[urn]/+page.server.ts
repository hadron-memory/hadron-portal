import { error, redirect } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { RESOLVE_URN_QUERY } from '$lib/server/queries';
import { withQuery } from '$lib/safeRedirect';
import { normalizeUrn } from '$lib/urn/parse-urn';
import type { PageServerLoad } from './$types';

/**
 * #262 — URN resolver route. Takes a Hadron URN in a single path segment
 * (URNs are colon-delimited, never slash-delimited, so the whole URN fits
 * one SvelteKit segment) and 307-redirects to the resource's canonical
 * PK-based page. URN links are stable, shareable aliases that survive PK
 * changes; the canonical page stays the single real page per resource.
 *
 * Resolution + access control live entirely in the server's `resolveUrn`
 * query, which returns null both for unresolvable URNs and for resources
 * the caller can't reach — so a no-access URN 404s exactly like a
 * nonexistent one, never disclosing existence. The route is namespaced
 * under `/app/u/` so a bare `[urn]` can't shadow the static `/app/*`
 * children (dashboard, agents, …).
 *
 * #761 — the redirect carries the incoming QUERY STRING through to the
 * canonical page. A URN link is the form we ask people to share, so every
 * deep link the portal has deliberately made linkable (`?tab=`, `?chat=`,
 * the #739 worklog filters) travels through here; dropping the query landed
 * the reader on the target's default view, having resolved and rendered
 * without erroring. That is the expensive kind of wrong — it looks like it
 * worked. The fragment needs no handling: browsers never send it, and
 * re-apply the original to a redirect target that carries none.
 */
type UrnResolution = {
  kind: 'memory' | 'node' | 'agent' | 'org' | 'app' | 'user' | 'worker';
  id: string;
  memoryId: string | null;
  organizationId: string | null;
};

const KNOWN_KINDS = new Set<UrnResolution['kind']>([
  'memory',
  'node',
  'agent',
  'org',
  'app',
  'user',
  // #735: the server has resolved `hrn:worker:` since #991, but the portal had
  // no page for it — so every worker identity signature required by
  // hadron-server#1008 landed the reader on this route's 404. That is the
  // opposite of what a signature is for, and it made the platform look like it
  // was pointing at something that did not exist.
  'worker',
]);

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const urn = normalizeUrn(params.urn);

  // #567: a URN the server *rejects* (GraphQL error) must not surface as an
  // unhandled 500 — but only KNOWN rejection codes are mapped, and only when
  // the ClientError actually carries a GraphQL errors payload (graphql-request
  // also uses ClientError for transport-level failures, which have none).
  // Validation codes → 400; expired/missing auth → the same signin redirect
  // the app hooks issue; not-found/no-access codes → the existence-hiding 404.
  // Everything else — internal server errors, unknown codes, payload-less
  // transport failures, non-GraphQL exceptions — rethrows so a genuine outage
  // stays a distinguishable 500 (see review:no-silent-loader-catch).
  let resolveUrn: UrnResolution | null;
  try {
    ({ resolveUrn } = await gqlClient(locals.token).request<{
      resolveUrn: UrnResolution | null;
    }>(RESOLVE_URN_QUERY, { urn }));
  } catch (err) {
    if (err instanceof ClientError && err.response?.errors?.length) {
      const code = (err.response.errors[0].extensions as { code?: string } | undefined)?.code;
      if (code === 'BAD_USER_INPUT' || code === 'GRAPHQL_VALIDATION_FAILED') {
        // #694: the server rejected the spelling outright, so the shape hint is
        // even more useful here than on a null resolution — this reader is
        // definitely holding a malformed URN rather than a dead one.
        const hint = shapeHint(urn);
        throw error(400, `"${urn}" is not a valid Hadron URN.${hint ? ` ${hint}` : ''}`);
      }
      if (code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED') {
        // #761: `url.search` too — signing in to reach a deep link must not be
        // what costs you the deep link's state.
        redirect(
          303,
          `/signin?redirect=${encodeURIComponent(withQuery(`/app/u/${params.urn}`, url.search))}`,
        );
      }
      if (
        code === 'NOT_FOUND' ||
        code === 'NODE_NOT_FOUND' ||
        code === 'FORBIDDEN' ||
        code === 'PERMISSION_DENIED'
      ) {
        throw error(404, notFoundMessage(urn));
      }
    }
    throw err;
  }

  if (!resolveUrn) {
    throw error(404, notFoundMessage(urn));
  }

  const target = canonicalPath(resolveUrn);
  if (!target) {
    if (!KNOWN_KINDS.has(resolveUrn.kind)) {
      // A kind the server resolved but the portal has no canonical page for.
      throw error(404, `No canonical portal page for "${resolveUrn.kind}" URNs.`);
    }
    // Known kind, but a required parent id was missing (node without memoryId,
    // app without organizationId) — a malformed/incomplete resolution rather
    // than a normal not-found. Surface that explicitly instead of redirecting
    // to a broken path.
    throw error(
      500,
      `Incomplete resolution for "${urn}": the ${resolveUrn.kind} is missing the ids needed to build its page.`,
    );
  }

  // 307 (temporary, method-preserving) — NOT 308, and this is a durable
  // platform contract rather than a local preference:
  // `hrn:node:hadronmemory.com:specs:cor:api:230:01` makes the temporary
  // redirect load-bearing in BOTH directions. A permanent
  // redirect would be cached by browsers/proxies and bypass this resolver
  // forever, stranding clients on a stale PK (URN aliases deliberately survive
  // PK changes, #262) — AND it would remove the per-visit access re-check,
  // which is what keeps a link a *pointer* rather than a capability: holding
  // one grants nothing, because resolution runs the resource's ordinary read
  // gate every time. That second reason is why a link may safely be handed to
  // someone who cannot open it, and it is the half this comment used to state
  // only in passing. The extra round-trip is the accepted cost.
  redirect(307, withQuery(target, url.search));
};

/**
 * #694 — explain an unresolved URN by the SHAPE OF THE INPUT, never by anything
 * learned about the data.
 *
 * A bare "not found" gives a reader no way to tell a wrong-grammar link from a
 * deleted node from a typo, and the three want completely different reactions.
 * The links this route exists to rescue are permanent — written into Slack
 * threads, node bodies, PR descriptions long before the grammar settled — so
 * "which of those am I looking at" is the reader's actual question.
 *
 * ## Why this is presentation and NOT resolution
 *
 * This runs only AFTER the server has already declined. It never pre-empts a
 * lookup, never rewrites the URN, and never decides that a spelling is
 * unresolvable — `resolveUrn` owns the alias map and is the only thing that can
 * tell an ownership chain from a flat URN. So when the server learns to resolve
 * a form listed here as unsupported, this hint stops appearing on its own,
 * rather than the portal having to be taught twice.
 *
 * ## Why it discloses nothing
 *
 * Per `hrn:node:hadronmemory.com:specs:cor:urn:030:02`, "no such alias" and
 * "aliased entity you may not see" must stay indistinguishable. Every branch
 * here is a statement about the CALLER'S OWN INPUT STRING — its prefix and its
 * separators — computed without reference to the resolution result, which is
 * uniformly null by the time we get here. A no-access URN and a nonexistent one
 * produce byte-identical messages.
 */
/**
 * The `hrn:<type>:` / legacy `urn:<type>:` prefix.
 *
 * The type word may contain HYPHENS — `chat-message`, `ai-config`, `app-mem`,
 * `group-mem`, `app-user` are all real (@copilot on #764). A `[a-z]+` class
 * would classify `hrn:chat-message:…` as prefix-less and then fail to strip it,
 * so both call sites share this one pattern rather than each carrying a copy
 * that can drift.
 */
const URN_SCHEME_PREFIX = /^(hrn|urn):[a-z][a-z-]*:/i;

function shapeHint(urn: string): string | null {
  if (!URN_SCHEME_PREFIX.test(urn)) {
    // The commonest broken spelling in the wild, and the one whose cause is
    // least guessable from "not found": nothing in the string says what KIND of
    // resource it names, so there is no single lookup to perform.
    return (
      `It has no "hrn:<type>:" prefix, so it does not say what kind of resource it names. ` +
      `A fully-qualified URN looks like "hrn:node:<org>:<memory>:<loc>" or "hrn:mem:<org>:<memory>".`
    );
  }

  // A URN that mixes the grammars resolves as neither — worth naming, since it
  // is plausible to hand-write from two half-remembered examples and otherwise
  // looks exactly like a deleted node.
  //
  // The test is the HIERARCHY separator, not "is there a colon anywhere"
  // (@codex on #764). A legacy loc routinely contains `:` — `findings:foo` —
  // while only the hierarchy uses `::`, so scanning the whole body flags
  // `hrn:node:acme.com::dev::findings:foo`, a perfectly valid legacy URN, and
  // sends the reader off to fix a spelling that was right. That is worse than
  // the bare message it replaces.
  //
  // So: if `::` appears at all, everything BEFORE the first `::` is hierarchy
  // and must not itself contain a `:`. `acme.com::dev::findings:foo` → "acme.com",
  // clean. `acme.com:dev::findings` → "acme.com:dev", v2-joined and then v1 —
  // genuinely mixed. Ownership chains pass, since their first atom is the root.
  const body = urn.replace(URN_SCHEME_PREFIX, '');
  const firstChain = body.indexOf('::');
  if (firstChain !== -1 && body.slice(0, firstChain).includes(':')) {
    // Describes what was OBSERVED, not what will happen. "Resolves as neither
    // grammar" was a claim about behaviour this check cannot establish.
    return (
      `It uses both the ":" and "::" separators. ` +
      `Try the current "hrn:node:<org>:<memory>:<loc>", or the older form with "::" throughout.`
    );
  }

  return null;
}

/** The 404 a reader gets for a URN that resolved to nothing. */
function notFoundMessage(urn: string): string {
  const hint = shapeHint(urn);
  if (hint) return `No resource found for "${urn}". ${hint}`;
  // THIS BRANCH MAKES NO CLAIM ABOUT THE URN. That is the point, and it took
  // four review rounds to get to (@codex on #764), each finding the same root
  // cause in a new disguise:
  //
  //   1. "the spelling is not the problem"  — ruled out a typo, but shape says
  //      nothing about whether the atoms are spelled right.
  //      `hrn:node:acme.com:hadron-prtal:review` is well-shaped AND a typo.
  //   2. "its grammar is fine"              — the checks are a type-SHAPED
  //      prefix and separator consistency; they validate neither the type word
  //      nor the arity. `hrn:bogus:x`, `hrn:user:alice:extra` reach here.
  //   3. "this is not the : versus :: problem" — the mixed-separator check only
  //      inspects the hierarchy BEFORE the first `::`, so
  //      `hrn:node:acme.com::dev:review` — v1 between org and memory, v2 before
  //      the loc — reaches here and is exactly that problem.
  //
  // Each fix was a narrower claim, and each was still falsifiable by a case the
  // check never examined. Detecting the remaining ones needs per-type arity —
  // i.e. parsing — and parsing is the one thing this route must not do:
  // `parseUrnV2` rejects `::` outright and a legacy ownership chain has no v2
  // form at all, so a parser gate would reject exactly the valid legacy links
  // #694 exists to rescue.
  //
  // So the fallback stops arguing and enumerates. Every cause is listed as
  // POSSIBLE and none is excluded, which is both honest and the only form that
  // a fifth counterexample cannot break. The diagnostic value lives in the two
  // POSITIVE branches above, which fire only when something specific was
  // actually observed.
  //
  // Kind-agnostic on purpose: this route resolves seven kinds, and naming "org,
  // memory or loc" was node-shaped advice for readers holding a
  // `hrn:user:<handle>` or a worker URN, whose parts are different.
  //
  // The existence/access disjunction is unchanged.
  return (
    `No resource found for "${urn}", or you do not have access to it. ` +
    `Possible causes: a typo in the identifier, a resource that was deleted or renamed, ` +
    `one that is not visible to you, or a URN spelling this deployment does not resolve.`
  );
}

/** Map a resolved URN to its canonical PK-based portal path. */
function canonicalPath(r: UrnResolution): string | null {
  switch (r.kind) {
    case 'memory':
      return `/app/memories/${r.id}`;
    case 'node':
      // memoryId is always set for nodes by the server resolver.
      return r.memoryId ? `/app/memories/${r.memoryId}/nodes/${r.id}` : null;
    case 'org':
      return `/app/orgs/${r.id}`;
    case 'agent':
      return `/app/agents/${r.id}`;
    case 'user':
      // #533: public profile page, PK-scoped like the other canonical pages.
      return `/app/user/${r.id}`;
    case 'app':
      // #648: canonical org-optional detail resolves both org-owned and
      // user-owned (org-less) apps, so a copied /app/u/<app-urn> link works for
      // a personal app too.
      return `/app/apps/${r.id}`;
    case 'worker':
      // #735/#991. Deliberately its OWN page rather than a redirect to the
      // App's Staff tab: the reader arriving from a signed GitHub issue is
      // asking "who is this", and a staff roster answers "which team" — so a
      // redirect would be both churn and the wrong answer (#737).
      //
      // Needs no id beyond `r.id`: `UrnResolution` carries no `appId`, but the
      // worker page reads `Worker.app` directly, so there is nothing to be
      // missing here.
      return `/app/workers/${r.id}`;
    default:
      return null;
  }
}
