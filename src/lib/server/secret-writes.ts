import type { GraphQLClient } from 'graphql-request';
import { extractGqlError } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import { readStagedChange } from '$lib/secrets/staged';

/**
 * portal#2380 — one App-secret write, as a result the page can render.
 *
 * A staged change is NOT a success and NOT a generic error: the value was not saved, a
 * request waits for the person's passkey signature on the server's page. The portal never
 * completes that ceremony (hrn:node:hadronmemory.com:specs:cor:sec:070:02).
 */
export type SecretWrite<D> =
  | { kind: 'ok'; data: D }
  | { kind: 'staged'; requestId: string; ceremonyUrl: string }
  | { kind: 'plain-protected' }
  | { kind: 'refused'; message: string };

export async function secretWrite<D>(
  client: Pick<GraphQLClient, 'request'>,
  doc: string,
  vars: Record<string, unknown>,
): Promise<SecretWrite<D>> {
  try {
    return { kind: 'ok', data: await client.request<D>(doc, vars) };
  } catch (e) {
    const staged = readStagedChange(e);
    if (staged?.kind === 'staged') return staged;
    if (staged) return { kind: 'plain-protected' };
    return { kind: 'refused', message: extractGqlError(e, t('secrets.write.failed', "That didn't go through. Try again.")) };
  }
}

export const PLAIN_PROTECTED_TEXT = () =>
  t('secrets.write.protected', 'This secret is protected, and only a person acting as themselves can change it. Nothing was changed.');

/** The server's rule: starts with a letter or digit, then letters, digits and hyphens, 64 at most. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const validSecretName = (n: string) => NAME.test(n);

/**
 * A number JSON.parse would round (an integer past 2^53, a value beyond float64) is not stored as a
 * number: the person typed one value and a different one would be saved, and a secret is write-only
 * so it would never show. The input is stored as text then.
 */
function losesNumbers(s: string): boolean {
  const bare = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const tok of bare.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []) {
    const n = Number(tok);
    if (!Number.isFinite(n)) return true;
    if (/^-?\d+$/.test(tok) && !Number.isSafeInteger(n)) return true;
  }
  return false;
}

/** Plain text is stored as text; text that parses as JSON, without losing a number, is stored as JSON. */
export function parseSecretValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return undefined;
  try {
    const v = JSON.parse(s);
    // null cannot be stored as a value, and a number JSON would round is not the number typed.
    return v === null || losesNumbers(s) ? raw : v;
  } catch {
    return raw;
  }
}
