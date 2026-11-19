import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const html = (document: Record<string, unknown>) =>
  render(Page, { props: { data: { document, nodeHref: '/app/memories/m/nodes/n' } } } as never).body;

describe('document page states', () => {
  it('words each too-large limit for what was actually hit', () => {
    const nodes = html({ state: 'too-large', cap: 300, limit: 'nodes' });
    const bytes = html({ state: 'too-large', cap: 300, limit: 'bytes' });
    const links = html({ state: 'too-large', cap: 300, limit: 'links' });
    const unknown = html({ state: 'too-large', cap: 300, limit: null });
    expect(nodes).toContain('too many specs');
    expect(nodes).toContain('limit is 300');
    expect(bytes).not.toContain('too many specs');
    expect(bytes).not.toContain('limit is 300');
    expect(bytes).toMatch(/too large/);
    expect(links).toMatch(/too many links/);
    expect(links).not.toContain('too many specs');
    expect(unknown).not.toContain('too many specs');
    expect(unknown).toMatch(/too large/);
  });
  it('shows the spec URN beside its name when there is a document', () => {
    const out = html({ state: 'ok', loc: 'cor:agt:110', name: 'Express checkout', urn: 'hrn:node:o.test:m:cor:agt:110', markdown: '# x' });
    expect(out).toContain('hrn:node:o.test:m:cor:agt:110');
  });
});
