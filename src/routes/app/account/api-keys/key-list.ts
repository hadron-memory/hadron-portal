import type { UserApiKey } from '$lib/types';

/** The list's own re-read (#1653 QA P2); see ./list/+server.ts for why it is not invalidateAll(). */
export const KEY_LIST_ENDPOINT = '/app/account/api-keys/list';

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** One key from the endpoint's payload, or null when any field is not what the page renders. */
function parseKey(raw: unknown): UserApiKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const k = raw as Record<string, unknown>;
  if (!text(k.id) || k.id === '' || !text(k.keyPreview) || !text(k.createdAt)) return null;
  if (!textOrNull(k.label) || !textOrNull(k.lastUsedAt) || !textOrNull(k.revokedAt) || !textOrNull(k.hiddenAt) || !textOrNull(k.issuedVia)) return null;
  return {
    id: k.id, keyPreview: k.keyPreview, label: k.label, createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, hiddenAt: k.hiddenAt, issuedVia: k.issuedVia,
  };
}

/** The whole list, or null: a failed read, and any malformed payload, is refused before it renders. */
export function parseKeyList(body: unknown): UserApiKey[] | null {
  if (!body || typeof body !== 'object') return null;
  const keys = (body as { keys?: unknown }).keys;
  if (!Array.isArray(keys)) return null;
  const parsed: UserApiKey[] = [];
  for (const raw of keys) {
    const key = parseKey(raw);
    if (!key) return null;
    parsed.push(key);
  }
  return parsed;
}

/** Re-read one view of the list. Never rejects: null means the read failed, for any reason. */
export async function readKeyList(includeHidden: boolean): Promise<UserApiKey[] | null> {
  try {
    const response = await fetch(includeHidden ? `${KEY_LIST_ENDPOINT}?includeHidden=true` : KEY_LIST_ENDPOINT, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return parseKeyList(await response.json());
  } catch {
    return null;
  }
}
