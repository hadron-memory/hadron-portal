import { describe, expect, it } from 'vitest';
import { nodeListHref } from './node-list-links';
import { commentSearchNode } from '$lib/test/fixtures/comment-search-pins';

describe('#1058 link-resolution seam (not malformed-hit rendering)', () => {
  it('links a valid target through the explicit base, then the memory fallback', () => {
    const node = commentSearchNode();
    expect(nodeListHref(node, '/app/memories/explicit')).toBe('/app/memories/explicit/nodes/target-pins?tab=discussion');
    expect(nodeListHref(node)).toBe('/app/memories/memory-pins/nodes/target-pins?tab=discussion');
  });
  it('falls back to the node URL without a target, and to empty without either base', () => {
    const node = commentSearchNode();
    const defensive = { ...node, comment: { ...node.comment!, target: undefined } as never };
    expect(nodeListHref(defensive, '/app/memories/explicit')).toBe('/app/memories/explicit/nodes/comment-row');
    expect(nodeListHref(defensive)).toBe('/app/memories/memory-pins/nodes/comment-row');
    expect(nodeListHref({ ...defensive, memory: undefined })).toBe('');
    expect(nodeListHref({ ...node, memory: undefined })).toBe('');
  });
});
