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

const NAME = /^[a-z0-9-]{1,64}$/;
export const validSecretName = (n: string) => NAME.test(n);

/** Plain text is stored as text; text that parses as JSON is stored as JSON. */
export function parseSecretValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return raw;
  }
}
