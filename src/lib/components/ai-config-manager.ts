// Pure helpers for AiServiceConfigManager.svelte (036-ai-service-config).
// Extracted from the component so the credential-encoding and apiKey
// keep/clear/replace logic can be unit-tested without a DOM.

import type { AIProvider } from '$lib/types';

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
  provider: AIProvider;
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
