/**
 * #1262 — client side of the S1 `cloneAgent` contract.
 *
 * Everything here is a presentation hint over a server that is authoritative:
 * the target-org list only narrows the picker (the server requires ADMIN in the
 * target and refuses otherwise), and every refusal is mapped to a fixed,
 * localized message. Nothing from `extensions` is passed through except the
 * sanitized blocker fields, so an unknown error can never dump a payload.
 */
import { extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';

type OrgWithMembers = {
  id: string;
  urn: string;
  name: string;
  members?: Array<{ role: string; user: { id: string } }> | null;
};

/** Orgs where the caller is OWNER or ADMIN — a UI hint only. */
export function eligibleCloneTargets<T extends OrgWithMembers>(orgs: T[], userId: string | null | undefined): T[] {
  if (!userId) return [];
  return orgs.filter((o) =>
    (o.members ?? []).some((m) => m.user.id === userId && (m.role === 'OWNER' || m.role === 'ADMIN')),
  );
}

/** The entry shows for a PUBLIC source or one the caller manages, and only with somewhere to clone to. */
export function showCloneEntry(o: { visibility: string | null | undefined; canManage: boolean; eligibleCount: number }): boolean {
  return o.eligibleCount > 0 && (o.visibility === 'PUBLIC' || o.canManage);
}

export type CloneBlocker = {
  code: string;
  count: number;
  subjects: Array<{ position: number; name?: string }>;
};

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
