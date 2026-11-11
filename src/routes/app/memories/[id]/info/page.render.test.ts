/** Memory Info overview/owner attribution; integration details live on the Integrations tab. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

function data(over: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return {
    graph: {
      id: 'm1', name: 'Docs', class: 'org', visibility: 'ORGANIZATION', tags: [], agent: null,
      shortDescription: null, description: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
      source: 'https://github.com/acme/docs', lastSyncedAt: null, syncStatus: 'OK', syncError: null,
      ...over,
    },
    org: null,
    ownerAttribution: null,
    nodesOff: true,
    ...top,
  };
}

describe('memory Info omits Git sync details (#1915)', () => {
  it('a failed sync shows neither duplicate details nor raw credentials', () => {
    const { body } = render(Page as never, { props: { data: data({
      syncStatus: 'ERROR',
      syncError: 'Command failed: git clone -- https://x-access-token:ghs_SECRETsecretSECRET1234@github.com/acme/docs.git /tmp',
    }) } as never });
    expect(body).not.toContain('The last sync failed.');
    expect(body).not.toContain('ghs_SECRET');
  });

  it('a healthy sync shows no failure text', () => {
    const { body } = render(Page as never, { props: { data: data({ syncStatus: 'OK' }) } as never });
    expect(body).not.toContain('The last sync failed.');
  });
});

it('keeps recorded partial reports off Info', () => {
  const body = render(Page as never, { props: { data: data({ lastSyncReport: JSON.stringify({ version: 1, outcome: 'partial', recordedAt: '2026-10-26T01:02:03.000Z', entries: [] }) }) } as never }).body;
  expect(body).not.toContain('Last recorded outcome');
});

it('portal#1524: the node count is hidden, never shown as 0, while the node list is off', () => {
  const { body } = render(Page as never, { props: { data: data({}) } as never });
  expect(body).not.toMatch(/>\s*0\s*</);
  expect(body).not.toContain('Nodes</span>');
});

describe('memory Info owner attribution (#1846 slice A)', () => {
  it('shows a member organization name and linked URN', () => {
    const body = render(Page as never, { props: { data: data({ organizationId: 'org-1' }, {
      org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com', members: [] },
      ownerAttribution: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com', source: 'member' },
    }) } as never }).body;
    expect(body).toContain('Acme');
    expect(body).toContain('hrn:org:acme.com');
    expect(body).toContain('href="/app/u/hrn:org:acme.com"');
    expect(body).toContain('aria-label="Copy organization URL"');
  });

  it('shows a discoverable non-member name and URN without an anchor', () => {
    const body = render(Page as never, { props: { data: data({ organizationId: 'org-1' }, {
      ownerAttribution: { id: 'org-1', name: 'Acme <script>', urn: 'hrn:org:acme.com', source: 'public' },
    }) } as never }).body;
    expect(body).toContain('Acme &lt;script');
    expect(body).not.toContain('Acme <script>');
    expect(body).toContain('hrn:org:acme.com');
    expect(body).not.toContain('href="/app/u/hrn:org:acme.com"');
    expect(body).toContain('aria-label="Copy organization URN"');
    expect(body).not.toContain('aria-label="Copy organization URL"');
  });

  it('shows only the plain canonical URN for an undiscoverable non-member', () => {
    const body = render(Page as never, { props: { data: data({ organizationId: 'org-1' }, {
      ownerAttribution: { urn: 'hrn:org:acme.com', source: 'memory-urn' },
    }) } as never }).body;
    expect(body).toContain('hrn:org:acme.com');
    expect(body).toMatch(/>hrn:<\/span>/);
    expect(body).toMatch(/>org:<\/span>/);
    expect(body).not.toContain('href="/app/u/hrn:org:acme.com"');
    expect(body).not.toContain('aria-label="Copy organization URL"');
    expect(body).not.toContain('Private name');
  });

  it('shows a dash for malformed attribution and preserves person and system owners', () => {
    const malformed = render(Page as never, { props: { data: data({ organizationId: 'org-1' }) } as never }).body;
    expect(malformed).toMatch(/Owner<\/span>[\s\S]*?—/);

    const personal = render(Page as never, { props: { data: data({ class: 'personal', organizationId: null, userId: 'owner' }, { user: { id: 'owner' } }) } as never }).body;
    expect(personal).toContain('Only you');

    const system = render(Page as never, { props: { data: data({
      class: 'system', organizationId: 'org-1', agent: { id: 'agent-1', name: 'System Agent', urn: 'hrn:agent:acme.com:system' },
    }) } as never }).body;
    expect(system).toContain('href="/app/agents/agent-1"');
    expect(system).toContain('System Agent');
    expect(system).toContain('hrn:agent:acme.com:system');
  });

  it('shows a dash, not Only you, when company attribution is unavailable for an org-anchored personal memory', () => {
    const body = render(Page as never, { props: { data: data(
      { class: 'personal', organizationId: 'org-1', userId: 'owner' },
      { user: { id: 'owner' }, ownerAttribution: null },
    ) } as never }).body;
    const ownerRow = body.match(/Owner<\/span>[\s\S]*?(?=<div class="flex items-center justify-between)/)?.[0] ?? '';
    expect(ownerRow).toContain('—');
    expect(ownerRow).not.toContain('Only you');
  });

  it('shows company attribution instead of Only you in an org-anchored personal Owner row', () => {
    const body = render(Page as never, { props: { data: data(
      { class: 'personal', organizationId: 'org-1', userId: 'owner' },
      {
        user: { id: 'owner' },
        ownerAttribution: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com', source: 'member' },
      },
    ) } as never }).body;
    const ownerRow = body.match(/Owner<\/span>[\s\S]*?(?=<div class="flex items-center justify-between)/)?.[0] ?? '';
    expect(ownerRow).toContain('Acme');
    expect(ownerRow).toContain('hrn:org:acme.com');
    expect(ownerRow).not.toContain('Only you');
    // Access remains principal-scoped even though the Owner row names the org.
    expect(body).toContain('Only you');
  });
});

// #1915: integration details belong to the dedicated Integrations tab.
describe('memory Info omits the duplicate integration summary (#1915)', () => {
  it.each([
    ['connected', { source: 'https://github.com/acme/docs', syncStatus: 'ERROR', syncError: 'sync failed' }],
    ['unconnected', { source: null, syncStatus: null, syncError: null }],
  ])('%s memory keeps Overview and Stats without an Integration section', (_state, graph) => {
    const body = render(Page as never, { props: { data: data(graph) } as never }).body;
    expect(body).toMatch(/<h2[^>]*>Overview<\/h2>/);
    expect(body).toMatch(/<h2[^>]*>Stats<\/h2>/);
    expect(body).not.toMatch(/<h2[^>]*>Integration<\/h2>/);
    expect(body).not.toContain('GitHub');
    expect(body).not.toContain('Repository');
    expect(body).not.toContain('Sync status');
    expect(body).not.toContain('Not connected');
  });
});
