import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CappedNotice from './CappedNotice.svelte';

describe('CappedNotice (#1226)', () => {
  it('names how many are shown and what they are, and does not claim completeness', () => {
    const { body } = render(CappedNotice, { props: { shown: 500, what: 'nodes' } });
    expect(body).toContain('role="status"');
    expect(body).toContain('Showing the first 500 nodes');
    expect(body).toContain('more exist');
  });
});
