/**
 * portal#2344 / #2377: the App register's stale 'Loading…' line is announced by a region that
 * exists before the page goes stale, holds the text while it is, and is the same element after.
 * Staleness is driven through `data.key` (the `$app/state` stub is not reactive).
 */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
const entry = { code: 'build.ready', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: 'hrn:node:acme.com:base:tasks:build', definedBy: null };
const data = (key: string) => ({
  app, agentRef: 'g1', chosen: agent, limit: 20, offset: 0, key,
  options: { kind: 'ok', agents: [agent], partial: false },
  index: { kind: 'ok', page: { entries: [entry], total: 1, hasMore: false } },
});

let m: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  m?.unmount();
  m = undefined;
  resetStubPage();
});

it('the Loading… line lives in one region that exists empty, speaks while stale and stays after', async () => {
  setStubPage('http://localhost/app/apps/app-1/register?agent=g1', { appId: 'app-1' });
  const props = reactiveProps({ data: data('app-1|g1|20|0') } as Record<string, unknown>);
  m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(3);

  const idle = idleStatusRegions(m.target);
  expect(idle.length).toBeGreaterThan(0);
  expect(announcedStatusRegion(m.target)).toBeNull();

  // The URL moved on and the answer on screen is for another page: stale.
  props.data = data('app-1|g1|20|20');
  await tick(3);
  const during = announcedStatusRegion(m.target);
  expect(during?.textContent).toContain('Loading…');
  expect(idle).toContain(during);

  // The answer for the URL being shown lands.
  props.data = data('app-1|g1|20|0');
  await tick(3);
  expect(announcedStatusRegion(m.target)).toBeNull();
  expect(during!.isConnected).toBe(true);
  expect(during!.textContent?.trim()).toBe('');
  expect(m.target.textContent).toContain('build.ready');
});
