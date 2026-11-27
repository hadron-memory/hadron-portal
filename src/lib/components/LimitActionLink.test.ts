import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LimitActionLink from './LimitActionLink.svelte';

describe('LimitActionLink (#2569)', () => {
  it('renders the extension link on its own line, and nothing without one', () => {
    const html = render(LimitActionLink, { props: { action: { label: 'See limits', href: '/app/orgs/o1/x' } } }).body;
    expect(html).toContain('href="/app/orgs/o1/x"');
    expect(html).toContain('>See limits<');
    expect(html).toMatch(/class="[^"]*\bblock\b/);
    expect(render(LimitActionLink, { props: { action: null } }).body).not.toContain('<a');
    expect(render(LimitActionLink, { props: {} }).body).not.toContain('<a');
  });
});
