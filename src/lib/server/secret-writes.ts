import type { GraphQLClient } from 'graphql-request';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import { readStagedChange } from '$lib/secrets/staged';
import { ceremonyOrigin } from '$lib/ceremony-origin';

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
    const staged = readStagedChange(e, ceremonyOrigin());
    if (staged?.kind === 'staged') return staged;
    if (staged?.kind === 'staged-unlinked') return { kind: 'refused', message: STAGED_UNLINKED_TEXT() };
    if (staged) return { kind: 'plain-protected' };
    // Mapped on the code, never a number: the caps are an engineering bound, not ruled
    // (hrn:node:hadronmemory.com:specs:cor:sec:070:02). For these codes the server's wording is
    // not shown; every other code goes through extractGqlError, which already withholds free text
    // for any code outside the framework/access set.
    const code = extractGqlErrorCode(e);
    // portal#2652: the server raises this code for a person's share of one secret and of the whole App
    // (hadron-server#5285), so the copy names neither.
    if (code === 'SECRET_CHANGE_REQUESTER_LIMIT') {
      return { kind: 'refused', message: t('secrets.write.requester-limit', 'You have too many open changes. Withdraw one of your open requests, or wait for one to expire, then try again.') };
    }
    if (code === 'SECRET_CHANGE_APP_LIMIT') {
      return { kind: 'refused', message: t('secrets.write.app-limit', 'This App has too many open secret changes. Finish or withdraw one, or wait for them to expire, then try again.') };
    }
    if (code === 'SECRET_CHANGE_REQUEST_LIMIT') {
      return { kind: 'refused', message: t('secrets.write.request-limit', 'This secret has too many open change requests. Wait for one to be signed or withdrawn, or to expire, then try again.') };
    }
    if (code === 'SECRET_KEY_UNAVAILABLE') {
      return { kind: 'refused', message: t('secrets.write.no-key', 'This deployment cannot store secrets yet: its secret key is not set up. Nothing was changed.') };
    }
    return { kind: 'refused', message: extractGqlError(e, t('secrets.write.failed', "That didn't go through. Try again.")) };
  }
}

/**
 * portal#2470: the server opened a change request but the portal cannot offer its signing page
 * (its link failed the origin pin). Never shows the link, and never says nothing is open.
 */
export const STAGED_UNLINKED_TEXT = () =>
  t('secrets.write.staged-unlinked', "This change was staged on the server, but this portal cannot offer its signing page. Open the request with the Hadron CLI or on the server's own page. Nothing has been changed yet.");

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
    if (numberLoses(tok)) return true;
  }
  return false;
}

/**
 * True when the double JSON.parse makes of `tok` is not the number typed: it is read back at the
 * token's own number of significant digits and must give the same digits and the same power of
 * ten. That catches an integer past 2^53, a decimal with more digits than float64 holds, a
 * subnormal (few digits survive), a value that underflows to zero and one that overflows.
 */
function numberLoses(tok: string): boolean {
  const n = Number(tok);
  if (!Number.isFinite(n)) return true;
  const [mant, expPart] = tok.split(/[eE]/);
  const [intRaw, frac = ''] = mant.replace('-', '').split('.');
  const all = intRaw + frac;
  const digits = all.replace(/^0+/, '').replace(/0+$/, '');
  if (digits === '') return false;
  if (digits.length > 100) return true;
  const lead = all.length - all.replace(/^0+/, '').length;
  const typedExp = intRaw.length - lead - 1 + Number(expPart ?? 0);
  const [backMant, backExp] = n.toExponential(digits.length - 1).split('e');
  return backMant.replace('-', '').replace('.', '').replace(/0+$/, '') !== digits || Number(backExp) !== typedExp;
}

/**
 * What is stored for a typed value. An object or array of JSON is stored as JSON (unless it holds a
 * number JSON would round); everything else, including a bare true, 42, 1.50 or "quoted", is stored
 * exactly as typed (line breaks as LF), so a secret never turns into a different value than the one in the field.
 */
export function parseSecretValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return undefined;
  // A browser submits a textarea's line breaks as CRLF; a key or certificate pasted over several
  // lines must reach the server with the LF it was copied with. Nothing else is changed.
  if (s[0] !== '{' && s[0] !== '[') return raw.replace(/\r\n/g, '\n');
  try {
    const v = JSON.parse(s);
    return losesNumbers(s) ? raw.replace(/\r\n/g, '\n') : v;
  } catch {
    return raw.replace(/\r\n/g, '\n');
  }
}
