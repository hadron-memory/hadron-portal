// Pure helpers for AiServiceConfigManager.svelte (036-ai-service-config).
// Extracted from the component so the credential-encoding and apiKey
// keep/clear/replace logic can be unit-tested without a DOM.

import type { AiConfigProvider } from '$lib/types';

/** Server contract: config name is 1–64 chars of [a-z0-9_-], unique per owner. */
export function isValidConfigName(name: string): boolean {
  return /^[a-z0-9_-]{1,64}$/.test(name);
}

/** Bedrock stores its three credential fields JSON-encoded into the single key. */
export function encodeBedrockKey(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
): string {
  return JSON.stringify({ accessKeyId, secretAccessKey, region });
}

/**
 * Collapse the form's key inputs into the raw key string to send, or '' when
 * the user entered nothing. For bedrock, the three fields are JSON-encoded;
 * for everything else it's the trimmed API-key field.
 */
export function resolveKeyInput(opts: {
  provider: AiConfigProvider;
  apiKey: string;
  bedrockAccessKeyId: string;
  bedrockSecretAccessKey: string;
  bedrockRegion: string;
}): string {
  if (opts.provider === 'bedrock') {
    const id = opts.bedrockAccessKeyId.trim();
    const secret = opts.bedrockSecretAccessKey.trim();
    if (id || secret) return encodeBedrockKey(id, secret, opts.bedrockRegion);
    return '';
  }
  return opts.apiKey.trim();
}

/**
 * Map the edit-form key state to the endpoint's apiKey discriminator:
 *   removeKey      → 'clear'  (server clears the stored key)
 *   a key entered  → 'set'    (server replaces)
 *   nothing        → 'keep'   (server keeps the stored key; omit the arg)
 */
export function resolveApiKeyAction(opts: {
  removeKey: boolean;
  enteredKey: string;
}): { apiKeyAction: 'keep' | 'clear' | 'set'; apiKey?: string } {
  if (opts.removeKey) return { apiKeyAction: 'clear' };
  if (opts.enteredKey) return { apiKeyAction: 'set', apiKey: opts.enteredKey };
  return { apiKeyAction: 'keep' };
}

/** Parse the params JSON textarea: empty ⇒ null; otherwise must be a JSON object. */
export function parseParamsText(
  text: string,
): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'Params must be valid JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Params must be a JSON object.' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

// ── #937 / server#1373: endpoint, apiStyle and the key rule ─────────────────
//
// These mirror hadron-server's `aiEndpoint.ts` (requireKeyFor,
// requireEndpointFor, validateApiStyle) so the form refuses what the server
// would refuse, before a round trip. The server stays the authority: a rule
// that drifts here only costs an earlier or later error, never a bypass.

export type AiApiStyle = 'CHAT_COMPLETIONS' | 'RESPONSES';

/** Providers that speak an OpenAI-style protocol, where apiStyle applies at all. */
const API_STYLE_PROVIDERS = new Set(['openai', 'glm', 'openai-compatible']);
export function apiStyleApplies(provider: string): boolean {
  return API_STYLE_PROVIDERS.has(provider);
}

/** A provider with no default host: its endpoint IS the configuration. */
export function endpointRequired(provider: string): boolean {
  return provider === 'openai-compatible';
}

/** Providers whose default host issued a credential the server holds. */
const AMBIENT_CREDENTIAL_PROVIDERS = new Set(['openai', 'anthropic', 'bedrock']);

/**
 * Whether a config needs its OWN key (server#1390, Holger 2026-09-26). Only
 * the platform's own config may go keyless, and only at the default host of a
 * provider that issued the server's credential. Every org, App and Agent
 * config needs a key, as does any config with an explicit endpoint.
 */
export function keyRequired(opts: { ownerType: string; provider: string; endpoint: string }): boolean {
  return !(opts.ownerType === 'HADRON_SERVER' && !opts.endpoint.trim() && AMBIENT_CREDENTIAL_PROVIDERS.has(opts.provider));
}

/**
 * A form value against the saved one, in the server's three-way update
 * grammar: `undefined` = unchanged (omit it), `null` = clear to the provider
 * default, otherwise the new value. Used for both the update and the test
 * override, whose endpoint/apiStyle args read the same way.
 */
export function fieldChange<T extends string>(saved: T | null | undefined, input: string): T | null | undefined {
  const next = input.trim();
  if (next === (saved ?? '')) return undefined;
  return next ? (next as T) : null;
}

/**
 * The endpoint field's own shape check: empty (provider default) or an
 * http(s) URL. Everything else (https-only on the hosted platform, no
 * credentials, the egress guard) is the server's call.
 */
export function endpointShapeError(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'The endpoint must be a full URL, like https://api.example.com/v1.';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'The endpoint must start with https://.';
  return null;
}

/**
 * Whether an UNSAVED config can be tested inline, by the portal's own client.
 * That client knows only the providers' built-in hosts, and its glm host is
 * the Coding Plan, not the server's default, so for these it would test
 * something other than what a run does. Those are tested after saving,
 * through the server's run path.
 */
export function inlineTestable(opts: { provider: string; endpoint: string; apiStyle: string }): boolean {
  return (
    !opts.endpoint.trim() &&
    !opts.apiStyle &&
    (opts.provider === 'anthropic' || opts.provider === 'openai' || opts.provider === 'bedrock')
  );
}
