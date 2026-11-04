import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import BootInstallCompile from './BootInstallCompile.svelte';
import BootProvenance from './BootProvenance.svelte';
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
const owner = { level: 'worker' as const, worker: 'w', app: 'a', agent: 'g' };
const view = { key: 'workerCompile:w:a:g', source: null, canStart: false, pointerMatches: false, compiled: { id: 'c', urn: 'hrn:node:example.com:install:boot:compiled', revision: 3, content: 'Compiled text', pending: true, lint: null } };
const page = { items: [], total: 0, offset: 0, hasMore: false, pruned: false };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
async function settle() { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } }
function findButton(root: HTMLElement, text: string) { return [...root.querySelectorAll('button')].find(b => b.textContent === text)!; }
describe('portal#1674 UX P2: outcomes belong beside controls', () => {
  it.each([true, false])('puts the %s outcome before provenance with a distinct light/dark tone', async ok => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (init?.method === 'POST') return reply({ ok, key: view.key, text: ok ? 'Built revision 3.' : 'Couldn’t confirm whether the prompt was built.' });
      if (String(input).includes('?node=')) return reply({ page });
      return reply(view);
    }));
    const m = mountComponent(BootInstallCompile, { owner, canManage: true }); cleanups.push(m.unmount); await settle();
    findButton(m.target, 'Update the prompt').click(); await settle();
    const outcome = [...m.target.querySelectorAll<HTMLElement>(ok ? '[role=status]' : '[role=alert]')].find(p => p.textContent?.includes(ok ? 'Built revision' : 'Couldn’t confirm'))!;
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('section[aria-label="Built from"]')).not.toBeNull(); });
    const provenance = m.target.querySelector('section[aria-label="Built from"]')!;
    expect(outcome.compareDocumentPosition(provenance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const classes = outcome.className + ' ' + outcome.parentElement!.className;
    expect(classes).toMatch(ok ? /text-green-/ : /text-red-/);
    expect(classes).toMatch(ok ? /dark:text-green-/ : /dark:text-red-/);
  });
  it('makes a failed provenance read visibly recoverable without retrying a write', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({}, false)).mockResolvedValueOnce(reply({ page }));
    vi.stubGlobal('fetch', fetcher);
    const m = mountComponent(BootProvenance, { nodeId: 'c', revision: 3 }); cleanups.push(m.unmount); await settle();
    const alert = m.target.querySelector<HTMLElement>('[role=alert]')!;
    expect(alert.className + ' ' + alert.parentElement!.className).toMatch(/text-red-/);
    findButton(m.target, 'Retry').click(); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('node=c');
    expect(m.target.textContent).toContain('Built from');
    expect(m.target.textContent).not.toContain('Couldn’t load');
  });
});

describe('portal#1674 BLIND P2-1: App pointer confirmation', () => {
  it('does not mutate on the initial click; explicit confirmation sends the selected App/Agent', async () => {
    const appOwner = { level: 'app' as const, app: 'a', agent: 'g' };
    const appView = { ...view, key: 'appCompile:a:g' };
    const fetcher = vi.fn(async (input, init) => {
      if (init?.method === 'POST') return reply({ ok: true, key: appView.key, text: 'Built revision 4.' });
      if (String(input).includes('?node=')) return reply({ page });
      return reply(appView);
    });
    vi.stubGlobal('fetch', fetcher);
    const m = mountComponent(BootInstallCompile, { owner: appOwner, canManage: true }); cleanups.push(m.unmount); await settle();
    findButton(m.target, 'Update the prompt').click(); await settle();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(m.target.textContent).toContain('point the App at it');
    findButton(m.target, 'Build and point App').click(); await settle();
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1]!.body as string).owner).toEqual(appOwner);
  });
});
