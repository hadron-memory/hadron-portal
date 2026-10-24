/**
 * #1262 — map a cloneAgent failure to what the clone page renders. Server-only
 * (reads the GraphQL error payload); the browser-safe helpers live in
 * $lib/agents/clone. Total: never throws, never leaks an unknown payload.
 */
import { extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import type { CloneBlocker } from '$lib/agents/clone';

export type CloneRefusal = {
  status: number;
  text: string;
  field?: 'slug';
  blockers?: CloneBlocker[];
};

const MAX_NAME = 200;

function parseBlockers(raw: unknown): CloneBlocker[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CloneBlocker[] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const { code, count, subjects } = b as Record<string, unknown>;
    if (typeof code !== 'string' || typeof count !== 'number') continue;
    const subs: CloneBlocker['subjects'] = [];
    for (const s of Array.isArray(subjects) ? subjects : []) {
      if (!s || typeof s !== 'object') continue;
      const { position, name } = s as Record<string, unknown>;
      if (typeof position !== 'number') continue;
      subs.push(typeof name === 'string' && name ? { position, name: name.slice(0, MAX_NAME) } : { position });
    }
    out.push({ code, count, subjects: subs });
  }
  return out.length ? out : undefined;
}

/** Map a cloneAgent failure to what the page renders. Total: never throws, never leaks. */
export function cloneRefusal(err: unknown): CloneRefusal {
  const code = extractGqlErrorCode(err);
  const ext = extractGqlErrorExtensions(err);
  switch (code) {
    case 'AGENT_NOT_PUBLIC':
      return { status: 403, text: t('agent.clone.err.not-public', 'This Agent is not public, so it cannot be cloned.') };
    case 'CLONE_LINKED_MEMORY_ENCRYPTED':
      return { status: 422, text: t('agent.clone.err.linked-encrypted', 'A memory linked to this Agent is encrypted and cannot be cloned.'), blockers: parseBlockers(ext?.blockers) };
    case 'CLONE_LINKED_MEMORY_UNREADABLE':
      return { status: 422, text: t('agent.clone.err.linked-unreadable', 'A memory linked to this Agent cannot be read by the clone, so it cannot be cloned.'), blockers: parseBlockers(ext?.blockers) };
    case 'CLONE_BASE_UNUSABLE':
      return { status: 422, text: t('agent.clone.err.base-unusable', "This Agent's base is not usable by the target organization.") , blockers: parseBlockers(ext?.blockers) };
    case 'CLONE_IMPORT_UNUSABLE':
      return { status: 422, text: t('agent.clone.err.import-unusable', 'An import of this Agent is not usable by the target organization.'), blockers: parseBlockers(ext?.blockers) };
    case 'CLONE_ENCRYPTED_CONTENT':
      return { status: 422, text: t('agent.clone.err.encrypted-content', "This Agent's system memory contains encrypted content and cannot be cloned.") };
    case 'CLONE_TARGET_UNSUPPORTED':
      return { status: 400, text: t('agent.clone.err.target-unsupported', 'Choose an organization as the target.') };
    case 'AGENT_URN_TAKEN':
      return { status: 409, field: 'slug', text: t('agent.clone.err.slug-taken', 'That slug is already used in the target organization. Choose another.') };
    case 'CONFLICT':
      if (ext?.reason === 'AGENT_CLONE_SOURCE_CHANGED') {
        return { status: 409, text: t('agent.clone.err.source-changed', 'The Agent changed while it was being cloned. Try again.') };
      }
      break;
    case 'NOT_FOUND':
    case 'AGENT_NOT_FOUND':
      return { status: 404, text: t('agent.clone.err.not-found', 'Agent not found or no longer available.') };
  }
  return { status: 503, text: t('agent.clone.err.failed', 'Could not clone the Agent. Your entries are kept; try again.') };
}
