import type { MemoryNode } from '$lib/types';

// Behavior-preserving extraction for #1058: target is required on rendered
// comment hits; defensive no-target links are tested here, never as malformed UI.
function nodeHref(node: MemoryNode, basePath: string): string {
  if (basePath) return `${basePath}/nodes/${node.id}`;
  // #260: memory pages are org-less, so the fallback needs only the memory id.
  const memId = node.memory?.id;
  if (memId) return `/app/memories/${memId}/nodes/${node.id}`;
  return '';
}

// portal#1015: a comment hit links back to the DISCUSSION on its target
// (hrn:node:hadronmemory.com:specs:cor:dmo:110:08), in the same memory (110:01), not to the comment node.
function discussionHref(node: MemoryNode, basePath: string): string {
  const target = node.comment?.target;
  if (!target) return '';
  const base = basePath ? `${basePath}/nodes/${target.id}` : node.memory?.id ? `/app/memories/${node.memory.id}/nodes/${target.id}` : '';
  return base ? `${base}?tab=discussion` : '';
}

export function nodeListHref(node: MemoryNode, basePath = ''): string {
  return node.comment ? discussionHref(node, basePath) || nodeHref(node, basePath) : nodeHref(node, basePath);
}
