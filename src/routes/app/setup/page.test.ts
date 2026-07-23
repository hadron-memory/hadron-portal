/**
 * #626: the new-user /app/setup landing. Before this route existed, the
 * server's `redirect: '/app/setup'` for a freshly-signed-up user 303'd into a
 * 404. These SSR smoke tests pin that the route renders and that its CTAs point
 * at real, reachable destinations (and degrade when no org / consumer mode).
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const baseData = {
  user: { id: 'u1', name: 'Ada Lovelace', handle: 'ada' },
  activeOrgId: 'org-1',
} as never;

describe('/app/setup', () => {
  it('greets the user by name and links the create-memory CTA to their active org', () => {
    const { body } = render(Page, { props: { data: baseData } });
    // Assert the interpolated name token (not the full English sentence) so the
    // smoke test survives i18n / copy changes.
    expect(body).toContain('Ada Lovelace');
    expect(body).toContain('href="/app/orgs/org-1/memories/new"');
    expect(body).toContain('href="/app/marketplace"');
    // "Skip for now" continues into the resolved workspace.
    expect(body).toContain('href="/app/orgs/org-1"');
  });

  it('falls back to a handle when no name is set', () => {
    const { body } = render(Page, {
      props: { data: { user: { id: 'u1', handle: 'ada' }, activeOrgId: 'org-1' } as never },
    });
    expect(body).toContain('@ada');
  });

  it('points the create-memory CTA at the org-less flow in consumer mode (#627)', () => {
    const { body } = render(Page, {
      props: {
        data: { user: { id: 'u1', name: 'Ada' }, activeOrgId: 'org-1', isConsumerMode: true } as never,
      },
    });
    // Individuals create a user-owned memory via /app/memories/new — NOT the
    // org-scoped route (requireNonConsumer would bounce that).
    expect(body).toContain('href="/app/memories/new"');
    expect(body).not.toContain('href="/app/orgs/org-1/memories/new"');
    expect(body).toContain('href="/app/marketplace"');
  });

  it('uses the org-less create flow and points skip at the marketplace when no org resolved', () => {
    const { body } = render(Page, {
      props: { data: { user: { id: 'u1', name: 'Ada' }, activeOrgId: null } as never },
    });
    expect(body).toContain('href="/app/memories/new"');
    expect(body).toContain('href="/app/marketplace"');
    expect(body).not.toContain('href="/app/orgs/');
  });
});
