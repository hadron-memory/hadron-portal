/**
 * portal#1490 — the restricted Worker Profile reads like the rest of the portal:
 * readable dates, a keyboard-operable way back that does not assume the reader
 * can open the App or Agent, and a Profile URL that is a link only when it is a
 * same-origin address the server handed us.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WorkerProfile from './WorkerProfile.svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import type { Worker } from '$lib/types';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const base = {
  id: 'w1', appId: 'app1', agentId: 'a1', name: 'Gemma', slug: 'gemma', urn: 'hrn:worker:example.com:team:gemma',
  portalUrl: 'http://localhost/app/u/hrn:worker:example.com:team:gemma', role: 'Portal Engineer',
  appUrn: null, appName: 'Team', ownerName: 'owner',
  createdAt: '2026-10-19T13:04:05.000Z', retiredAt: null, agent: null, memoryId: null, hasLiveSession: null,
} as unknown as Worker;

async function show(over: Partial<Worker> = {}) {
  setStubPage('http://localhost/app/workers/w1');
  const m = mountComponent(WorkerProfile, { worker: { ...base, ...over } } as never); mounted.push(m); await tick(5);
  return m.target;
}
const dd = (target: HTMLElement, label: string) =>
  [...target.querySelectorAll('dt')].find(d => d.textContent?.trim() === label)?.nextElementSibling as HTMLElement;

describe('dates', () => {
  it('renders an ISO created date in the portal date style, not verbatim', async () => {
    const target = await show({ createdAt: new Date(2026, 9, 19, 13, 4, 5).toISOString() });
    expect(dd(target, 'Cast').textContent?.trim()).toBe('Oct 19, 2026, 1:04:05 PM');
  });
  it('renders the epoch instant as a date, and a retired date too', async () => {
    const target = await show({ createdAt: '1970-01-01T00:00:00.000Z', retiredAt: new Date(2026, 10, 1, 9, 0, 0).toISOString() });
    expect(dd(target, 'Cast').textContent).not.toContain('T00:00');
    expect(dd(target, 'Cast').textContent).toMatch(/19(69|70)/);
    expect(dd(target, 'Retired').textContent?.trim()).toBe('Nov 1, 2026, 9:00:00 AM');
  });
  it('renders an invalid date neutrally, never "Invalid Date" or the raw text', async () => {
    const target = await show({ createdAt: 'not-a-date' });
    expect(dd(target, 'Cast').textContent?.trim()).toBe('—');
    expect(target.textContent).not.toContain('Invalid Date');
  });
});

describe('navigation', () => {
  it('has a focusable way back to the Dashboard, not to the App or Agent', async () => {
    const target = await show();
    const nav = target.querySelector('nav[aria-label]');
    expect(nav).not.toBeNull();
    const back = nav!.querySelector('a') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/app/dashboard');
    expect(back.tabIndex).toBeGreaterThanOrEqual(0);
    expect(nav!.querySelector('a[href^="/app/apps"]')).toBeNull();
  });
});

describe('Profile URL', () => {
  it('links the server-provided same-origin portalUrl', async () => {
    const target = await show();
    const a = dd(target, 'Profile URL').querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(base.portalUrl);
  });
  it.each(['https://evil.example/app/u/x', 'javascript:alert(1)', '//evil.example/x', 'not a url'])(
    'shows %s as plain text, never a link', async portalUrl => {
      const target = await show({ portalUrl });
      expect(dd(target, 'Profile URL').querySelector('a')).toBeNull();
      expect(dd(target, 'Profile URL').textContent?.trim()).toBe(portalUrl);
    });
  it('shows nothing (neutral dash) for a null portalUrl', async () => {
    const target = await show({ portalUrl: null });
    expect(dd(target, 'Profile URL').querySelector('a')).toBeNull();
    expect(dd(target, 'Profile URL').textContent?.trim()).toBe('—');
  });
});
