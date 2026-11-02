/**
 * portal#1349 — the board's search box and an EXACT handle. The search reads
 * titles and descriptions, so a valid handle offers a real link to that task
 * (the route resolves it on the server) and submitting it opens the task;
 * anything else searches as before and offers nothing. A server render never
 * types, so this lives in the client lane.
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

function mountBoard(text = '', tasks = [row('t1', 'AT3', 'Ship it')]) {
  const m = mountComponent(Board as never, {
    data: {
      app, view: 'board', filter: 'active', text, alarmFilter: 'open', boardLimit: 200, alarmsLimit: 2000,
      loadedAt: '2026-10-16T01:00:00Z', impersonating: null, roster: null, alarms: null, composition: null, refs: {},
      board: { kind: 'ok', value: { capped: false, tasks } },
    },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m;
}

async function type(m: Mounted<Record<string, unknown>>, text: string) {
  const input = m.target.querySelector<HTMLInputElement>('#task-board-search')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  return input;
}
/** Submits the search form the way Enter does; true when the page took the submit over. */
async function submit(m: Mounted<Record<string, unknown>>) {
  const e = new Event('submit', { bubbles: true, cancelable: true });
  m.target.querySelector<HTMLFormElement>('form[aria-label="Search tasks"]')!.dispatchEvent(e);
  await tick(1);
  return e.defaultPrevented;
}
const gotos = () => navigationCalls.filter((c) => c.fn === 'goto').map((c) => c.args[0]);
const openLink = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLAnchorElement>('[data-testid="open-by-handle"] a');

describe('board search: an exact handle', () => {
  it('offers a link to a handle that is not on the loaded page (a subtask), under this App', async () => {
    const m = mountBoard();
    expect(openLink(m)).toBeNull();
    await type(m, 'AT3.405');
    expect(openLink(m)?.getAttribute('href')).toBe('/app/apps/app-1/tasks/AT3.405');
    expect(openLink(m)?.textContent).toContain('Open AT3.405');
  });

  it('submitting it opens the task instead of searching; the destination is the same link', async () => {
    const m = mountBoard();
    await type(m, 'AT3.405');
    expect(await submit(m)).toBe(true);
    expect(gotos()).toEqual(['/app/apps/app-1/tasks/AT3.405']);
  });

  // Uma's P2: a handle pasted with surrounding space (a terminal or chat copy) is still one.
  it.each([['AT3.405 ', 'AT3.405'], [' AT3', 'AT3'], ['\tAT3.405\n', 'AT3.405']])('%j is trimmed to %j and opens it', async (text, handle) => {
    const m = mountBoard();
    await type(m, text);
    expect(openLink(m)?.getAttribute('href')).toBe(`/app/apps/app-1/tasks/${handle}`);
    expect(await submit(m)).toBe(true);
    expect(gotos()).toEqual([`/app/apps/app-1/tasks/${handle}`]);
  });

  it.each(['AT3.', 'AT3..4', 'ship it', 'AT03', 'AT3.0'])('%j is only a search: no link, and the submit goes to the server', async (text) => {
    const m = mountBoard();
    await type(m, text);
    expect(openLink(m)).toBeNull();
    expect(await submit(m)).toBe(false);
    expect(gotos()).toEqual([]);
  });

  it.each(['AT3.', 'at3.4x'])('a no-match search for %j, shaped like part of a handle, says handles open only when complete', (text) => {
    const m = mountBoard(text, []);
    expect(m.target.textContent).toContain('Handles open only when complete, for example AT3.405.');
  });

  it('a no-match search for ordinary text gets the plain empty line', () => {
    const m = mountBoard('ship it', []);
    expect(m.target.textContent).toContain('No matching tasks.');
    expect(m.target.textContent).not.toContain('Handles open only when complete');
  });

  it('a search that landed with a handle as its text (no JavaScript) still offers the link', () => {
    const m = mountBoard('AT3.405');
    expect(openLink(m)?.getAttribute('href')).toBe('/app/apps/app-1/tasks/AT3.405');
  });

  it('a qualified handle of another App is still just forwarded: the route answers it as unknown, the portal decides nothing', async () => {
    const m = mountBoard();
    await type(m, 'hrn:agenttask:acme.com:other:AT3');
    expect(openLink(m)?.getAttribute('href')).toBe(`/app/apps/app-1/tasks/${encodeURIComponent('hrn:agenttask:acme.com:other:AT3')}`);
  });

  // portal#1415 item 3 (cf30a11c P3 2): the link NAMES the canonical handle
  // `parseHandle` returns, never the case the user typed — and a bare handle
  // is canonicalized everywhere it travels (text, href, submit), so the URL
  // bar shows the spelling the server recognizes.
  it('a typed lowercase bare handle shows and opens the CANONICAL spelling: text, href and submit agree', async () => {
    const m = mountBoard();
    await type(m, 'at3.405');
    expect(openLink(m)?.textContent).toBe('Open AT3.405');
    expect(openLink(m)?.getAttribute('href')).toBe('/app/apps/app-1/tasks/AT3.405');
    expect(await submit(m)).toBe(true);
    expect(gotos()).toEqual(['/app/apps/app-1/tasks/AT3.405']);
  });

  it('a qualified handle still names its bare handle in the link text while the href forwards the full spelling', async () => {
    const m = mountBoard();
    await type(m, 'hrn:agenttask:acme.com:other:AT3');
    expect(openLink(m)?.textContent).toBe('Open AT3');
  });

  // portal#1415 item 3 (P3 c): the link appears and disappears as the typed
  // text crosses in and out of being a whole handle, silently for a screen
  // reader unless the paragraph is a live region. Polite (role=status), not
  // assertive — this is a hint beside a search box, never an alarm
  // (review:ticking-content-outside-live-region: dynamic content in a live
  // region is polite, and this one carries no per-tick text).
  it('the link is announced: its paragraph is a polite status region, present only while the text is a whole handle', async () => {
    const m = mountBoard();
    const region = () => m.target.querySelector('[data-testid="open-by-handle"]');
    expect(region()).toBeNull();
    await type(m, 'AT3.405');
    expect(region()?.getAttribute('role')).toBe('status');
    await type(m, 'AT3.405x');
    expect(region()).toBeNull();
  });
});
