import { describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import TreeView from './TreeView.svelte';
import type { TreeEntry } from '$lib/types';

// #1161: the tree marks a node the server reported deleted; nothing else.
// Client lane: TreeView reads $app/stores, which only the client project aliases.
const entry = (id: string, nodeId: string, name: string, extra: Partial<TreeEntry> = {}): TreeEntry => ({
  id, nodeId, name, seq: null, nodeType: 'info', hasActions: false, isVirtual: false, ...extra,
});

describe('TreeView deleted marker (#1161)', () => {
  it('badges only entries flagged deleted', () => {
    const { target, unmount } = mountComponent(TreeView as never, {
      entries: [entry('live', 'n1', 'Live One'), entry('gone', 'n2', 'Gone One', { deleted: true })],
      basePath: '/app/memories/m1',
    } as never);
    const badges = target.querySelectorAll('[data-testid="node-deleted"]');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('a,button')?.textContent).toContain('Gone One');
    unmount();
  });
});
