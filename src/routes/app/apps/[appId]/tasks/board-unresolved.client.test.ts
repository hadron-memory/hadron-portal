/**
 * portal#1643 — the board's Unresolved findings narrow (hadron-server#2663). It is offered where a finished task can
 * be (Ended, All), says so in one note when it was dropped, and the form really submits it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const data = (over: Record<string, unknown> = {}) => ({
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  view: 'board', filter: 'ended', text: '', boardLimit: 200, loadedAt: '2026-11-13T00:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { capped: false, tasks: [] } }, ...over,
});
async function mount(over = {}) {
  const m = mountComponent(Harness as never, { initial: data(over) } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
const form = (m: Mounted<any>) => m.target.querySelector('form[method=GET]') as HTMLFormElement;
const submitted = (m: Mounted<any>) => [...new FormData(form(m)).entries()].map(([k, v]) => [k, String(v)]);
const box = (m: Mounted<any>) => m.target.querySelector('input[name=unresolved]') as HTMLInputElement;
const note = (m: Mounted<any>) => m.target.querySelector('#task-unresolved-guidance') as HTMLElement;

describe('Unresolved findings', () => {
  it.each(['ended', 'all'])('is offered in %s with its definition', async (filter) => {
    const m = await mount({ filter });
    expect(box(m).getAttribute('aria-disabled')).toBeNull();
    expect(box(m).closest('label')!.textContent).toContain('Unresolved findings');
    expect(box(m).closest('label')!.className).not.toMatch(/cursor-not-allowed/);
    expect(note(m).textContent).toContain('subtasks included');
  });
  it.each(['active', 'queued', 'backlog'])('is unavailable in %s, readable, and says where it applies', async (filter) => {
    const m = await mount({ filter });
    expect(box(m).getAttribute('aria-disabled')).toBe('true');
    expect(box(m).closest('label')!.className).toMatch(/text-zinc-500/);
    expect(note(m).textContent).toContain('Ended and All');
  });
  it('when dropped, the status note IS the guidance (one note, not two)', async () => {
    const m = await mount({ filter: 'active', unresolvedDropped: true });
    expect(m.target.querySelectorAll('[data-testid=unresolved-dropped]')).toHaveLength(1);
    expect(note(m).textContent).toContain('Unresolved findings was turned off');
    expect(m.target.querySelectorAll('#task-unresolved-guidance')).toHaveLength(1);
  });
  it('the form submits it only when on, beside the bucket', async () => {
    expect(submitted(await mount({ filter: 'ended', unresolved: true }))).toContainEqual(['unresolved', '1']);
    expect(submitted(await mount({ filter: 'ended' })).some(([k]) => k === 'unresolved')).toBe(false);
  });
  it('a board with only Unresolved set is filtered, so an empty board names Clear', async () => {
    const m = await mount({ filter: 'ended', unresolved: true });
    expect(m.target.querySelector('[data-empty]')!.textContent).toMatch(/No tasks match these filters\. Clear removes them\./);
  });
});
