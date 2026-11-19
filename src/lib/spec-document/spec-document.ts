/**
 * #1720: the assembled spec document view. Consumes `Query.specDocument`
 * (hadron-server#1302 / #3535, hrn:node:hadronmemory.com:specs:cor:spc:030:02):
 * the server's Markdown is the content; the portal only renders it.
 */
import { extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';
import { t } from '$lib/i18n/t';

/**
 * hrn:node:hadronmemory.com:specs:cor:acl:130:01: a node is a spec when the base kind of its role (the part
 * before the first dot) is exactly `spec`. `special` and `specification` are
 * not specs, and neither is a citation-shaped loc or a memory that holds
 * specs. A node with no role is not a spec.
 */
export function isSpecRole(role: string | null | undefined): boolean {
  if (typeof role !== 'string') return false;
  return role.split('.', 1)[0] === 'spec';
}

/** `<loc with every character outside A-Z a-z 0-9 . _ as ->.md`, safe as a download name. Never empty; a leading `.` or `-` becomes `_` (a leading `-` reads as a command-line option). */
export function specDocumentFilename(loc: string): string {
  const base = loc.replace(/[^A-Za-z0-9._]/g, '-').replace(/^[.-]/, '_');
  return `${base === '' ? 'spec-document' : base}.md`;
}

/** Which of the server's three limits a too-large refusal hit (extensions.limit). */
export type SpecDocumentLimit = 'nodes' | 'bytes' | 'links';

export type SpecDocumentFailure =
  | { kind: 'not-found' }
  | { kind: 'encrypted' }
  | { kind: 'too-large'; cap: number | null; limit: SpecDocumentLimit | null };

/**
 * The server's refusals this view words itself. An unreadable memory, a
 * missing memory and a loc with no live spec are all `*_NOT_FOUND` and become
 * ONE state, so the view discloses no more than the server's answer. Returns
 * null for anything else, which the caller rethrows to the error page.
 */
export function classifySpecDocumentFailure(e: unknown): SpecDocumentFailure | null {
  const code = extractGqlErrorCode(e);
  if (!code) return null;
  if (code.endsWith('_NOT_FOUND')) return { kind: 'not-found' };
  if (code === 'SPEC_CORPUS_ENCRYPTED_UNSUPPORTED') return { kind: 'encrypted' };
  if (code === 'SPEC_DOCUMENT_TOO_LARGE') {
    const ext = extractGqlErrorExtensions(e);
    const cap = ext?.cap;
    const limit = ext?.limit;
    return {
      kind: 'too-large',
      cap: typeof cap === 'number' && Number.isFinite(cap) ? cap : null,
      // Only the three words the server sends; anything else is the plain line.
      limit: limit === 'nodes' || limit === 'bytes' || limit === 'links' ? limit : null,
    };
  }
  return null;
}

/** The node-menu entry that opens the assembled view: present only for a spec node, absent on every other. */
export function viewDocumentMenuAction(role: string | null | undefined): Array<{ id: 'view-document'; label: string }> {
  return isSpecRole(role) ? [{ id: 'view-document', label: t('node-actions.view-document', 'View as document') }] : [];
}
