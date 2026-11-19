/**
 * portal#1434 — task-board filter polish (P3s from the #1427 reviews).
 * Pins: the filtered-empty line says Clear removes the filters; the disabled
 * Overdue label stays readable (not zinc-400 on white) while still visibly
 * unavailable; the Overdue note is ONE line (the dropped notice replaces the
 * guidance, it does not repeat it); Overdue has its own row on a phone; and the
 * form actually SUBMITS the checkbox and tags fields (native FormData, not prose).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const data = (over: Record<string, unknown> = {}) => ({
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  view: 'board', filter: 'active', text: '', boardLimit: 200, loadedAt: '2026-10-29T00:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { capped: false, tasks: [] } }, ...over,
});
async function mount(over = {}) {
  const m = mountComponent(Harness as never, { initial: data(over) } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
const form = (m: Mounted<any>) => m.target.querySelector('form[method=GET]') as HTMLFormElement;
const submitted = (m: Mounted<any>) => [...new FormData(form(m)).entries()].map(([k, v]) => [k, String(v)]);
const box = (m: Mounted<any>) => m.target.querySelector('input[name=overdue]') as HTMLInputElement;
const guidance = (m: Mounted<any>) => m.target.querySelector('#task-overdue-guidance') as HTMLElement;

describe('filtered-empty line names Clear (portal#1434 item 1)', () => {
  it('says Clear removes the filters', async () => {
    const m = await mount({ tags: ['ops'] });
    expect(m.target.querySelector('[data-empty]')!.textContent).toMatch(/No tasks match these filters\. Clear removes (them|the filters)\./);
  });
  it('the Clear it names exists', async () => {
    const m = await mount({ tags: ['ops'] });
    expect([...m.target.querySelectorAll('a')].some((a) => a.textContent === 'Clear')).toBe(true);
  });
});

describe('disabled Overdue stays readable but unavailable (portal#1434 item 2)', () => {
  it.each(['ended', 'backlog'])('%s: label is not the faint zinc-400, and still reads as unavailable', async (filter) => {
    const m = await mount({ filter });
    const label = box(m).closest('label')!;
    expect(label.className).not.toMatch(/(^|\s)text-zinc-400/);
    expect(label.className).toMatch(/(^|\s)text-zinc-500/);
    expect(label.className).toMatch(/cursor-not-allowed/);
    expect(box(m).getAttribute('aria-disabled')).toBe('true');
    expect(box(m).disabled).toBe(false);
  });
  it('an offered Overdue keeps the normal label colour', async () => {
    const label = box(await mount({ filter: 'active' })).closest('label')!;
    expect(label.className).toMatch(/text-zinc-700/);
    expect(label.className).not.toMatch(/cursor-not-allowed/);
  });
});

describe('one Overdue note, not two (portal#1434 item 3)', () => {
  it('dropped: the status note IS the Overdue guidance, the unavailable line is not repeated', async () => {
    const m = await mount({ filter: 'ended', overdueDropped: true });
    expect(guidance(m).textContent).toContain('Overdue was turned off');
    expect(m.target.textContent).not.toContain('Overdue applies to Active, Queued and All tasks.');
    expect(m.target.querySelectorAll('[data-testid=overdue-dropped]')).toHaveLength(1);
    expect(box(m).getAttribute('aria-describedby')).toBe('task-overdue-guidance');
  });
  it('unavailable and not dropped: the guidance line explains why', async () => {
    const m = await mount({ filter: 'ended' });
    expect(guidance(m).textContent).toContain('Overdue applies to Active, Queued and All tasks.');
    expect(m.target.querySelector('[data-testid=overdue-dropped]')).toBeNull();
  });
  it('offered: the guidance line states the server rule exactly (portal#2244 + portal#2248 review: Gil P2 1, Jonas P2 2)', async () => {
    const text = guidance(await mount({ filter: 'active' })).textContent;
    expect(text).toContain('a pending task past its start-by, or a pending or started task past its finish-by');
    expect(text).toContain('Backlog and ended tasks are never overdue');
    expect(text).not.toContain('The server decides.');
  });
});

describe('Overdue has its own row on a phone (portal#1434 item 4)', () => {
  it('its wrapper is full-width below sm and shrinks back at sm', async () => {
    const wrap = box(await mount()).closest('label')!.parentElement!;
    expect(wrap.className).toMatch(/\bbasis-full\b|\bw-full\b/);
    expect(wrap.className).toMatch(/sm:(w-auto|basis-auto)/);
  });
});

describe('the form submits what it shows (portal#1434 item 5, native FormData)', () => {
  it('a checked Overdue and a tag list are submitted', async () => {
    const m = await mount({ filter: 'queued', overdue: true, tags: ['ops', 'infra'], text: 'x' });
    expect(submitted(m)).toEqual([['status', 'queued'], ['view', 'board'], ['text', 'x'], ['tags', 'ops, infra'], ['overdue', '1']]);
  });
  it('an unchecked Overdue is absent, and empty tags submit as empty', async () => {
    const m = await mount({ filter: 'active' });
    expect(submitted(m)).toEqual([['status', 'active'], ['view', 'board'], ['text', ''], ['tags', '']]);
  });
  it('user toggling the offered box changes what is submitted', async () => {
    const m = await mount({ filter: 'active' });
    box(m).click();
    expect(submitted(m).some(([k, v]) => k === 'overdue' && v === '1')).toBe(true);
    box(m).click();
    expect(submitted(m).some(([k]) => k === 'overdue')).toBe(false);
  });
  it('the unavailable box cannot be switched on by a click, so nothing is submitted', async () => {
    const m = await mount({ filter: 'ended' });
    box(m).click();
    expect(box(m).checked).toBe(false);
    expect(submitted(m).some(([k]) => k === 'overdue')).toBe(false);
  });
  it('a typed tag value is submitted verbatim', async () => {
    const m = await mount({ filter: 'all' });
    const tags = m.target.querySelector('input[name=tags]') as HTMLInputElement;
    tags.value = 'a,b';
    expect(submitted(m).find(([k]) => k === 'tags')![1]).toBe('a,b');
  });
});
