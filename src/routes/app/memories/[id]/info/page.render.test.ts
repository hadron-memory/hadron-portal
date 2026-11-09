/** #988: the memory Info page explains a failed Git sync, redacted, and only when it failed. */
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

describe('memory Info page, Git sync (#988)', () => {
  it('a failed sync shows why, without any credential from the raw git error', () => {
    const { body } = render(Page as never, { props: { data: data({
      syncStatus: 'ERROR',
      syncError: 'Command failed: git clone -- https://x-access-token:ghs_SECRETsecretSECRET1234@github.com/acme/docs.git /tmp',
    }) } as never });
    expect(body).toContain('The last sync failed.');
    expect(body).not.toContain('ghs_SECRET');
  });

  it('a healthy sync shows no failure text', () => {
    const { body } = render(Page as never, { props: { data: data({ syncStatus: 'OK' }) } as never });
    expect(body).not.toContain('The last sync failed.');
  });
});

it('shows a recorded partial report in Info', () => {
  const body = render(Page as never, { props: { data: data({ lastSyncReport: JSON.stringify({ version: 1, outcome: 'partial', recordedAt: '2026-10-26T01:02:03.000Z', entries: [] }) }) } as never }).body;
  expect(body).toContain('Last recorded outcome'); expect(body).toContain('succeeded');
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

    const personal = render(Page as never, { props: { data: data({ class: 'personal', organizationId: null }) } as never }).body;
    expect(personal).toContain('Only you');

    const system = render(Page as never, { props: { data: data({
      class: 'system', organizationId: 'org-1', agent: { id: 'agent-1', name: 'System Agent', urn: 'hrn:agent:acme.com:system' },
    }) } as never }).body;
    expect(system).toContain('href="/app/agents/agent-1"');
    expect(system).toContain('System Agent');
    expect(system).toContain('hrn:agent:acme.com:system');
  });
});
