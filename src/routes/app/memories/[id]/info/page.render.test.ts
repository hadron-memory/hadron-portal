/** #988: the memory Info page explains a failed Git sync, redacted, and only when it failed. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

function data(over: Record<string, unknown>) {
  return {
    graph: {
      id: 'm1', name: 'Docs', class: 'org', visibility: 'ORGANIZATION', tags: [], agent: null,
      shortDescription: null, description: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
      source: 'https://github.com/acme/docs', lastSyncedAt: null, syncStatus: 'OK', syncError: null,
      ...over,
    },
    org: null,
    nodesOff: true,
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
