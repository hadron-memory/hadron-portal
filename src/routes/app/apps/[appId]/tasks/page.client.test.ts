/**
 * portal#1400 — the board is REUSED across its own navigations (a search, a
 * clear, a status chip are GETs to the same route), so the table's page index
 * has to be reset by the page, not left to a remount that never happens.
 * An SSR render never mounts or navigates, so this is the client lane.
 */
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Board from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const owner = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const tasks = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`, parentTaskId: null, title: `${prefix} task ${i}`, status: 'STARTED', queued: false, waitingOnChildren: false,
    source: null, owner, assignee: null, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: `2026-10-15T10:${String(i).padStart(2, '0')}:00Z`, tags: [],
  }));
const data = (over: Record<string, unknown>) => ({
  app, view: 'board', filter: 'active', text: '', boardLimit: 200, loadedAt: '2026-10-16T01:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { tasks: tasks(45, 'a'), capped: false } }, ...over,
});

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});
const pageText = (m: Mounted<Record<string, unknown>>) => m.target.querySelector('[data-testid="table-footer"] span')?.textContent?.trim();
const next = (m: Mounted<Record<string, unknown>>) =>
  [...m.target.querySelectorAll('[data-testid="table-footer"] button')].find((b) => b.textContent?.trim() === 'Next') as HTMLButtonElement;

describe('board page index', () => {
  it('goes back to page 1 when a search arrives, when it is cleared, and when the status changes', () => {
    const props = reactiveProps({ data: data({}) });
    mounted = mountComponent(Board as never, props as never) as never;
    const m = mounted!;
    expect(pageText(m)).toBe('Page 1 of 3');

    const toPageTwo = () => {
      next(m).click();
      flushSync();
      expect(pageText(m)).toBe('Page 2 of 3');
    };

    toPageTwo();
    props.data = data({ text: 'needle', board: { kind: 'ok', value: { tasks: tasks(45, 'b'), capped: false } } });
    flushSync();
    expect(pageText(m)).toBe('Page 1 of 3');

    toPageTwo();
    props.data = data({ text: '', board: { kind: 'ok', value: { tasks: tasks(45, 'c'), capped: false } } });
    flushSync();
    expect(pageText(m)).toBe('Page 1 of 3');

    toPageTwo();
    props.data = data({ filter: 'ended', board: { kind: 'ok', value: { tasks: tasks(45, 'd'), capped: false } } });
    flushSync();
    expect(pageText(m)).toBe('Page 1 of 3');
  });

  it('does not reset on a refresh that changes nothing about the search or the status', () => {
    const props = reactiveProps({ data: data({}) });
    mounted = mountComponent(Board as never, props as never) as never;
    const m = mounted!;
    next(m).click();
    flushSync();
    expect(pageText(m)).toBe('Page 2 of 3');
    props.data = data({ loadedAt: '2026-10-16T02:00:00Z', board: { kind: 'ok', value: { tasks: tasks(45, 'a'), capped: false } } });
    flushSync();
    expect(pageText(m)).toBe('Page 2 of 3');
  });
});
void vi;
