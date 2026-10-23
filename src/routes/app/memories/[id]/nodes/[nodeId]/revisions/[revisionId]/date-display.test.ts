import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

describe('revision timestamp (#1167)', () => {
  it('keeps the date style consistent and retains the edit time', () => {
    const html = render(Page, { props: { data: {
      memoryId: 'mem-1', nodeId: 'node-1',
      revision: { id: 'r1', name: 'Earlier', loc: 'sample', tags: [], revNo: 2,
        createdAt: new Date(2026, 9, 19, 13, 4, 5).toISOString(), content: null },
      provenance: Promise.resolve(null), changes: Promise.resolve(null),
    } as never } }).body;
    expect(html).toContain('Oct 19, 2026, 1:04:05 PM');
  });
});
