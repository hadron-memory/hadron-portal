/**
 * portal#1349 — the board's search box and an EXACT handle. The filter only sees
 * the loaded roots, so a valid handle offers a real link to that task (the
 * route resolves it on the server); anything else filters as before and
 * offers nothing. A server render never types, so this lives in the client lane.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Board from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const owner = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const row = (id: string, handle: string, title: string) => ({
  id, handle, parentTaskId: null, title, status: 'STARTED', queued: false, waitingOnChildren: false, source: null,
  owner, assignee: null, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [],
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => resetNavigationCalls());
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

function mountBoard() {
  const m = mountComponent(Board as never, {
    data: {
      app, view: 'board', filter: 'active', alarmFilter: 'open', boardLimit: 200, alarmsLimit: 2000,
      loadedAt: '2026-10-16T01:00:00Z', impersonating: null, roster: null, alarms: null, composition: null, refs: {},
      board: { kind: 'ok', value: { capped: false, tasks: [row('t1', 'AT3', 'Ship it')] } },
    },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m;
}

async function type(m: Mounted<Record<string, unknown>>, text: string) {
  const input = m.target.querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  return input;
}
const openLink = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLAnchorElement>('[data-testid="open-by-handle"] a');

describe('board search: an exact handle', () => {
  it('offers a link to a handle that is not on the loaded page (a subtask), under this App', async () => {
    const m = mountBoard();
    expect(openLink(m)).toBeNull();
    await type(m, 'AT3.405');
    expect(openLink(m)?.getAttribute('href')).toBe('/app/apps/app-1/tasks/AT3.405');
    expect(openLink(m)?.textContent).toContain('Open AT3.405');
  });

  it('the handle is also a searchable field of a loaded row', async () => {
    const m = mountBoard();
    await type(m, 'AT3');
    expect(m.target.textContent).toContain('Ship it');
    await type(m, 'zzz');
    expect(m.target.textContent).not.toContain('Ship it');
  });

  it('Enter in the box opens it; the destination is the same link', async () => {
    const m = mountBoard();
    const input = await type(m, 'AT3.405');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick(1);
    expect(navigationCalls.filter((c) => c.fn === 'goto').map((c) => c.args[0])).toEqual(['/app/apps/app-1/tasks/AT3.405']);
  });

  it.each(['AT3.', 'AT3..4', 'AT3.405 ', ' AT3', 'ship it', 'AT03', 'AT3.0'])('%j is only a filter: no link, no navigation on Enter', async (text) => {
    const m = mountBoard();
    const input = await type(m, text);
    expect(openLink(m)).toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick(1);
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toEqual([]);
  });

  it('a qualified handle of another App is still just forwarded: the route answers it as unknown, the portal decides nothing', async () => {
    const m = mountBoard();
    await type(m, 'hrn:agenttask:acme.com:other:AT3');
    expect(openLink(m)?.getAttribute('href')).toBe(`/app/apps/app-1/tasks/${encodeURIComponent('hrn:agenttask:acme.com:other:AT3')}`);
  });
});
