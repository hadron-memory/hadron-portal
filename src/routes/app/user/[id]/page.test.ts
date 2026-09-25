/**
 * #919 — the profile page's Workers tab, SSR: the tab strip, and the four
 * states of the read (rows, empty, truncated, failed) each saying what it is.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/stores', () => ({
  page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/'), data: {} }), () => {}) },
}));
vi.mock('$app/navigation', () => ({ goto: () => {}, invalidate: () => {} }));

import Page from './+page.svelte';

const user = { id: 'user-1', handle: 'alice', urn: 'hrn:user:alice', githubUsername: null, avatarUrl: null };
const worker = {
  id: 'w1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara', role: 'server-engineer',
  appId: 'app-1', appUrn: 'hrn:app:acme.com:team', heldAt: '2026-09-20T10:00:00Z',
  hasLiveSession: true, lastActiveAt: '2026-09-25T10:00:00Z',
};
const page = (heldWorkers: unknown) => render(Page, { props: { data: { user, heldWorkers } } as never }).body;

describe('profile page — the Workers tab (#919)', () => {
  it('is a real tab strip whose first and only tab is Workers, selected', () => {
    const body = page({ ok: true, items: [worker], total: 1 });
    expect(body).toContain('role="tablist"');
    expect(body.match(/role="tab"/g)).toHaveLength(1);
    expect(body).toMatch(/role="tab"[^>]*aria-selected="true"/);
    expect(body).toContain('aria-controls="user-panel-workers"');
    expect(body).toContain('role="tabpanel"');
    expect(body).toMatch(/role="tab"[^>]*>\s*Workers\s*</);
  });

  it('lists the held workers, the live one marked', () => {
    const body = page({ ok: true, items: [worker], total: 1 });
    expect(body).toContain('href="/app/workers/w1"');
    expect(body).toContain('Active now');
  });

  it('says "none you can see", not "holds none", when empty', () => {
    const body = page({ ok: true, items: [], total: 0 });
    expect(body).toContain('data-testid="held-workers-empty"');
    expect(body).toContain('No workers you can see are held by this user.');
  });

  it('says when the page is not the whole list', () => {
    const body = page({ ok: true, items: [worker], total: 250 });
    expect(body).toContain('data-testid="held-workers-truncated"');
    expect(body).toContain('Showing 1 of 250 held workers.');
  });

  it('reports a failed read as a failure, not as an empty roster', () => {
    const body = page({ ok: false, detail: 'heldWorkers down' });
    expect(body).toContain('data-testid="held-workers-failed"');
    expect(body).toContain('heldWorkers down');
    expect(body).not.toContain('data-testid="held-workers-empty"');
  });
});
