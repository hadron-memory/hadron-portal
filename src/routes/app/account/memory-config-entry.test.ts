import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<div>tab body</div>' }));

describe('account memory-config entry (#1749 B1)', () => {
  it('renders the node-role templates entry with preload-data off', () => {
    setStubPage('https://example.test/app/account/node-role-templates');
    const html = render(Layout, { props: { children } }).body;
    const link = (html.match(/<a\b[^>]*>/g) ?? []).find((tag) => tag.includes('href="/app/account/node-role-templates"'));
    expect(link).toBeDefined();
    expect(link).toContain('data-sveltekit-preload-data="off"');
  });
});
