/**
 * portal#1649 — the action-register section, mounted. Everything it draws, controls included, comes from the one panel
 * on screen, so there is no answer under another answer's controls; a choice or a page is a navigation to the section's
 * own URL. portal#2344 / #2377: the Loading… line is announced by a region that exists before the navigation, holds the
 * text while it runs and is the same element after.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AppRegister from './AppRegister.svelte';

const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
const other = { id: 'g2', name: 'Tester', urn: 'hrn:agent:acme.com:tester' };
const entry = { code: 'build.ready', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: 'hrn:node:acme.com:base:tasks:build', definedBy: null };
const panel = (over: Record<string, unknown> = {}) => ({
  agentRef: 'g1', chosen: agent, limit: 20, offset: 0,
  options: { kind: 'ok', agents: [agent, other], partial: false },
  index: { kind: 'ok', page: { entries: [entry], total: 41, hasMore: true } },
  ...over,
});

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
  resetNavigationCalls();
});
async function mountIt(p: unknown) {
  const m = mountComponent(AppRegister as never, { appId: 'app-1', panel: p } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}
const click = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!.click();

describe('the action-register section', () => {
  it('draws the chosen Agent and its codes, and says to choose one when none is chosen', async () => {
    const root = await mountIt(panel());
    expect(root.textContent).toContain('Builder');
    expect(root.textContent).toContain('build.ready');
    document.body.innerHTML = '';
    const none = await mountIt(panel({ agentRef: '', chosen: null, index: null }));
    expect(none.textContent).toContain('Choose an Agent to see its codes.');
    expect(none.textContent).not.toContain('build.ready');
  });

  it('paging links name the section and the section’s own parameters, so the page’s other lists are left alone', async () => {
    const root = await mountIt(panel({ limit: 50 }));
    const next = [...root.querySelectorAll<HTMLAnchorElement>('a')].map((a) => a.getAttribute('href') ?? '').find((h) => h.includes('registerOffset='))!;
    expect(next).toBe('/app/apps/app-1?tab=settings&section=register&registerAgent=g1&registerLimit=50&registerOffset=50');
    expect(next).not.toMatch(/[?&](offset|limit|agent)=/);
  });

  it('choosing another Agent navigates to the section’s URL for it, starting at the first page', async () => {
    const root = await mountIt(panel({ offset: 20 }));
    click(root, 'Change…');
    await tick(3);
    root.ownerDocument.querySelector<HTMLButtonElement>('button[aria-label*="Tester"]')!.click();
    await tick(3);
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1?tab=settings&section=register&registerAgent=g2');
  });

  it('the Loading… line lives in one region that exists empty, speaks during the navigation and stays after', async () => {
    let release!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((r) => { release = r; });
    const root = await mountIt(panel());
    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(root)).toBeNull();
    click(root, 'Change…');
    await tick(3);
    root.ownerDocument.querySelector<HTMLButtonElement>('button[aria-label*="Tester"]')!.click();
    await tick(3);
    const during = announcedStatusRegion(root);
    expect(during?.textContent).toContain('Loading…');
    expect(idle).toContain(during);
    release();
    await tick(4);
    expect(announcedStatusRegion(root)).toBeNull();
    expect(during!.isConnected).toBe(true);
    expect(during!.textContent?.trim()).toBe('');
  });

  it('keeps an Agent the server refuses, a failed read and a failed Agent list apart', async () => {
    expect((await mountIt(panel({ index: { kind: 'agent-not-found' } }))).querySelector('[data-testid="register-agent-refused"]')).not.toBeNull();
    document.body.innerHTML = '';
    expect((await mountIt(panel({ index: { kind: 'failed' } }))).querySelector('[data-testid="register-failed"]')).not.toBeNull();
    document.body.innerHTML = '';
    expect((await mountIt(panel({ chosen: null, agentRef: '', index: null, options: { kind: 'failed' } }))).textContent).toContain('Couldn’t load this App’s Agents.');
  });
});
