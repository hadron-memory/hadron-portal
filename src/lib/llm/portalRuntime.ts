/**
 * Which AI configs the portal's chat runtime may run (stopgap, Holger 2026-09-27). Client-safe and pure: the
 * server runtime refuses with it before a key is used, and the App page (portal#1963) labels a dropdown entry
 * with it, so the two can never disagree. Moved here from $lib/server/llm/agentChatLlm, which re-exports it.
 */

// ── Which configs this runtime may run (stopgap, Holger 2026-09-27) ─────────
//
// This runtime calls providers from the PORTAL with the config's decrypted key,
// at the hosts below, and knows nothing of a config's endpoint. A config whose
// endpoint was set elsewhere (the CLI, the API) would otherwise be run against
// one of these hosts with a key issued for a different one. So it runs only
// configs whose server-resolved effective endpoint IS a host it calls, and
// refuses the rest loudly.
//
// The direction (Holger): custom endpoints are called only by the server, which
// has the egress guard for them, and portal chat turns move there. Until then
// this is the containment, not the fix.

/** The GLM host this runtime has always called (Z.ai Coding Plan). */
export const GLM_PORTAL_HOST = 'https://api.z.ai/api/coding/paas/v4';

/**
 * Per provider, the effective endpoints this runtime may run. `null`: the
 * provider has no endpoint (the SDK derives it), so a config must have none.
 *
 * GLM also admits the server's default (general) host although this runtime
 * calls the Coding Plan host. That mismatch predates the stopgap and needs its
 * own decision (some users rely on Coding Plan keys), so it is kept as it was.
 */
const PORTAL_RUNTIME_HOSTS: Readonly<Record<string, readonly string[] | null>> = {
  anthropic: ['https://api.anthropic.com/v1'],
  openai: ['https://api.openai.com/v1'],
  glm: [GLM_PORTAL_HOST, 'https://api.z.ai/api/paas/v4'],
  bedrock: null,
};

/**
 * Whether two endpoints name the same place. Scheme and host are compared
 * case-insensitively (URL normalizes them, and a default port); the PATH is
 * case-sensitive, so `/V1` is not `/v1` (Codex on #958). Only a single trailing
 * slash is ignored, and any query or fragment makes it a different endpoint.
 */
function sameEndpoint(a: string, b: string): boolean {
  const parse = (u: string) => {
    try {
      return new URL(u.trim());
    } catch {
      return null;
    }
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  // At most ONE trailing slash is ignored: `/v1//` is not `/v1` (Codex on #958).
  const path = (u: URL) => u.pathname.replace(/\/$/, '');
  return pa.origin === pb.origin && path(pa) === path(pb) && pa.search === pb.search && pa.hash === pb.hash;
}

/**
 * The endpoint's host, for a message, or null when it doesn't parse as a URL.
 * Only a parsed host is ever shown: a string that isn't a URL could carry
 * anything (a token in a would-be query string, say), so it is never echoed
 * into a chat or judge message (Dara and Charles on #958).
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null;
  } catch {
    return null;
  }
}

/** A resolve that failed because the server predates `effectiveEndpoint` (#1373). */
export function isMissingEffectiveEndpoint(message: string): boolean {
  return /Cannot query field\W+effectiveEndpoint/.test(message);
}

export const EFFECTIVE_ENDPOINT_UNSUPPORTED =
  "The Hadron server didn't recognize effectiveEndpoint, which portal chats need to check where an AI configuration sends requests, so the chat won't run. The server may be older than this portal.";

const INVALID_ENDPOINT = "This AI configuration's endpoint isn't a valid URL, so portal chats won't run it. Check the configuration's endpoint, or use another configuration.";

/**
 * Why this runtime must not run a resolved config, or null when it may.
 * `effectiveEndpoint` is the server's (ResolvedAiConfig): where a request for
 * the config is meant to go. What can't be checked is refused, not assumed.
 */
export function portalRuntimeRefusal(config: { provider: string; effectiveEndpoint?: string | null }): string | null {
  const { provider } = config;
  const endpoint = config.effectiveEndpoint ?? null;
  if (!Object.hasOwn(PORTAL_RUNTIME_HOSTS, provider)) {
    return `This AI configuration uses the "${provider}" provider, which portal chats can't run yet: only the Hadron server calls it. Until portal chats run on the server, use a configuration with a built-in provider.`;
  }
  const hosts = PORTAL_RUNTIME_HOSTS[provider];
  if (hosts === null) {
    if (endpoint === null) return null;
    const host = hostOf(endpoint);
    return host
      ? `This AI configuration has an endpoint (${host}), which portal chats can't use for ${provider}. Remove the endpoint, or use another configuration.`
      : INVALID_ENDPOINT;
  }
  if (endpoint === null) {
    return `Portal chats couldn't confirm where this AI configuration sends requests, so they won't run it. Check the configuration's endpoint, or use another configuration.`;
  }
  if (!hosts.some((h) => sameEndpoint(h, endpoint))) {
    const host = hostOf(endpoint);
    if (!host) return INVALID_ENDPOINT;
    return `This AI configuration sends requests to a custom endpoint (${host}), which portal chats can't use yet: custom endpoints are called only by the Hadron server. Until portal chats run on the server, use a configuration on the provider's default endpoint.`;
  }
  return null;
}
