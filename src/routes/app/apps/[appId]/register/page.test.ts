/**
 * portal#1654 item 6 — the App view's stale-response guard: forcing `stale` to
 * false must fail a test. The guard compares the answer's own key with the URL
 * being shown, so a paging or limit transition (not only an Agent change) never
 * draws the old page under the new URL.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
const entry = { code: 'build.ready', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: 'hrn:node:acme.com:base:tasks:build', definedBy: null };
const data = (key: string, over: Record<string, unknown> = {}) => ({
  app, agentRef: 'g1', chosen: agent, limit: 20, offset: 0, key,
  options: { kind: 'ok', agents: [agent], partial: false },
  index: { kind: 'ok', page: { entries: [entry], total: 1, hasMore: false } },
  ...over,
});
const draw = (key: string, search: string, appId = 'app-1') => {
  setStubPage(`http://localhost/app/apps/${appId}/register${search}`, { appId });
  return render(Page as never, { props: { data: data(key) } as never }).body;
};
afterEach(() => resetStubPage());

describe('App register page stale guard', () => {
  it('draws the answer when its key is the URL being shown', () => {
    const out = draw('app-1|g1|20|0', '?agent=g1');
    expect(out).toContain('build.ready');
    expect(out).not.toContain('Loading…');
  });
  it.each([
    ['another Agent', '?agent=g2'],
    ['another page', '?agent=g1&offset=20'],
    ['another limit', '?agent=g1&limit=50'],
  ])('does not draw an answer for %s', (_n, search) => {
    const out = draw('app-1|g1|20|0', search);
    expect(out).not.toContain('build.ready');
    expect(out).toContain('Loading…');
  });
  // #1731 BLIND P2-1: the App term must come from the route, not from the (possibly stale) answer.
  it('does not draw app-1\'s answer under app-2\'s URL when Agent, limit and offset are unchanged', () => {
    const out = draw('app-1|g1|20|0', '?agent=g1', 'app-2');
    expect(out).not.toContain('build.ready');
    expect(out).toContain('Loading…');
  });
  it('still draws the answer when the route App is the one it was asked for', () => {
    expect(draw('app-1|g1|20|0', '?agent=g1', 'app-1')).toContain('build.ready');
  });
});
