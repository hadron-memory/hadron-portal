/**
 * portal#1654 item 2 — the folded header's toggle names only what it holds: a
 * table with search off must not say "Search".
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TableFrameHarness from '$lib/test/TableFrameHarness.svelte';

const toggle = (props: Record<string, unknown>) =>
  render(TableFrameHarness as never, { props: props as never }).body.split('data-testid="table-header-toggle"')[1].split('</button>')[0];

describe('TableFrame toggle label', () => {
  it('says "Search, views & columns" when search is on (the default)', () => {
    expect(toggle({})).toContain('Search, views &amp; columns');
  });
  it('says "Views & columns" when search is off', () => {
    const out = toggle({ showSearch: false });
    expect(out).toContain('Views &amp; columns');
    expect(out).not.toMatch(/search/i);
  });
});
