/** #1058: unchanged NodeList URL helpers, exposed for defensive-branch pins. */
import type { MemoryNode } from './types';

export function nodeHref(node: Pick<MemoryNode, 'id' | 'memory' | 'comment'>, basePath = ''): string {
  if (basePath) return `${basePath}/nodes/${node.id}`;
  // #260: memory pages are org-less, so the fallback needs only the memory id.
  const memId = node.memory?.id;
  if (memId) return `/app/memories/${memId}/nodes/${node.id}`;
  return '';
}

// portal#1015: a comment hit links back to the DISCUSSION on its target
// (hrn:node:hadronmemory.com:specs:cor:dmo:110:08), in the same memory (110:01), not to the comment node.
export function discussionHref(node: Pick<MemoryNode, 'id' | 'memory' | 'comment'>, basePath = ''): string {
  const target = node.comment?.target;
  if (!target) return '';
  const base = basePath ? `${basePath}/nodes/${target.id}` : node.memory?.id ? `/app/memories/${node.memory.id}/nodes/${target.id}` : '';
  return base ? `${base}?tab=discussion` : '';
}
