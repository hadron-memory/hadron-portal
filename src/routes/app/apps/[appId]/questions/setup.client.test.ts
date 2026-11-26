/**
 * portal#2237 (Questions P4) — the question-log setup form and the log lines, on screen.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const person = (id: string, name: string) => ({ id, name, handle: name.toLowerCase() });
const memory = (id: string, name: string) => ({ id, name, urn: `hrn:mem:acme.com:${id}` });
const log = (over: Record<string, unknown> = {}) => ({
  id: 'l1', urn: 'hrn:node:acme.com:team:questions', name: 'Questions', memoryId: 'm1', prefix: 'D', portalUrl: 'https://hadronmemory.com/app/u/hrn:node:acme.com:team:questions',
  defaultDeciders: [person('u1', 'Ada'), person('u2', 'Bob')], eligibleDeciders: [person('u1', 'Ada'), person('u2', 'Bob')], revSeq: 3, ...over,
});
const emptyList = { kind: 'ok', value: { total: 0, items: [] } };
const noLog = (over: Record<string, unknown> = {}) => ({
  app: { id: 'a1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  filter: { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 }, viewerId: 'u1', impersonating: null,
  questions: emptyList, logs: { kind: 'ok', value: [] },
  people: { people: [person('u1', 'Ada'), person('u2', 'Bob')], withheld: false, failed: false },
  navigation: { offset: 0, count: 0, total: 0, previousHref: null, nextHref: null },
  setup: { memories: [memory('m1', 'Team notes'), memory('m2', 'Runbooks')], deciders: { people: [person('u1', 'Ada'), person('u2', 'Bob')], fixed: false }, viewer: person('u1', 'Ada') },
  ...over,
});
const withLog = (over: Record<string, unknown> = {}) => noLog({ logs: { kind: 'ok', value: [log()] }, setup: null, ...over });
async function mount(data: Record<string, unknown>, form: unknown = null) {
  const m = mountComponent(Page as never, { data, form } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
const setupForm = (m: Mounted<any>) => m.target.querySelector<HTMLFormElement>('form[data-testid=question-log-setup]');
const text = (m: Mounted<any>) => m.target.textContent!.replace(/\s+/g, ' ');

describe('the form (no log yet)', () => {
  it('is titled once and posts to the createQuestionLog action', async () => {
    const m = await mount(noLog());
    const form = setupForm(m)!;
    expect(form).not.toBeNull();
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.getAttribute('action')).toBe('?/createQuestionLog');
    expect(text(m)).toContain('Set up questions for this App');
    expect(form.querySelector('button[type=submit]')?.textContent?.trim()).toBe('Create question log');
  });

  it('offers the memories in a select, labelled', async () => {
    const m = await mount(noLog());
    const select = setupForm(m)!.querySelector<HTMLSelectElement>('select[name=memoryId]')!;
    expect([...select.options].map((o) => [o.value, o.textContent!.trim()])).toEqual([['m1', 'Team notes'], ['m2', 'Runbooks']]);
    expect(m.target.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
  });

  it('a single qualifying memory is shown as text with a hidden input, not a select', async () => {
    const m = await mount(noLog({ setup: { memories: [memory('m1', 'Team notes')], deciders: { people: [person('u1', 'Ada')], fixed: false }, viewer: person('u1', 'Ada') } }));
    const form = setupForm(m)!;
    expect(form.querySelector('select[name=memoryId]')).toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[type=hidden][name=memoryId]')?.value).toBe('m1');
    expect(form.textContent).toContain('Team notes');
  });

  it('pre-checks the viewer among the deciders and leaves the rest unchecked', async () => {
    const m = await mount(noLog());
    const boxes = [...setupForm(m)!.querySelectorAll<HTMLInputElement>('input[type=checkbox][name=deciders]')];
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([['u1', true], ['u2', false]]);
    for (const b of boxes) expect(m.target.querySelector(`label[for="${b.id}"]`) ?? b.closest('label')).not.toBeNull();
  });

  it('with members withheld offers only the viewer, checked and fixed', async () => {
    const m = await mount(noLog({ people: { people: [], withheld: true, failed: false }, setup: { memories: [memory('m1', 'Team notes'), memory('m2', 'Runbooks')], deciders: { people: [person('u1', 'Ada')], fixed: true }, viewer: person('u1', 'Ada') } }));
    const form = setupForm(m)!;
    expect(form.querySelectorAll('input[type=checkbox][name=deciders]').length).toBe(0);
    expect(form.querySelector<HTMLInputElement>('input[type=hidden][name=deciders]')?.value).toBe('u1');
    expect(form.textContent).toContain('Ada');
  });

  it('submits exactly the memory and the checked deciders', async () => {
    const m = await mount(noLog());
    const sent = [...new FormData(setupForm(m)!).entries()].map(([k, v]) => [k, String(v)]);
    expect(sent).toEqual([['memoryId', 'm1'], ['deciders', 'u1']]);
  });

  it('no longer sends the reader to the CLI to create a log', async () => {
    const m = await mount(noLog());
    expect(text(m)).not.toContain('hadron question log create');
    expect(text(m)).toContain('This App has no question log yet, so its agents cannot ask questions.');
  });

  it('shows a refusal from the action, from the portal’s own text', async () => {
    const m = await mount(noLog(), { createLog: { error: 'An encrypted memory cannot hold a question log.' } });
    expect(m.target.querySelector('[role=alert]')?.textContent).toContain('An encrypted memory cannot hold a question log.');
  });

  it('with no memory that can hold a log, says so instead of showing an empty select', async () => {
    const m = await mount(noLog({ setup: { memories: [], deciders: { people: [person('u1', 'Ada')], fixed: false }, viewer: person('u1', 'Ada') } }));
    expect(setupForm(m)).toBeNull();
    expect(text(m)).toMatch(/no memory that can hold a question log/i);
  });

  it('with the App’s memories unavailable, says it could not load them, not that there are none', async () => {
    const m = await mount(noLog({ setup: { memories: null, deciders: { people: [person('u1', 'Ada')], fixed: false }, viewer: person('u1', 'Ada') } }));
    expect(setupForm(m)).toBeNull();
    expect(m.target.querySelector('[role=alert]')?.textContent).toMatch(/Couldn.t load the App.s memories/);
  });
});

describe('UX seat findings (P2 x2, P3 x3)', () => {
  it('after a refused submit the form keeps the memory and the people that were chosen', async () => {
    const m = await mount(noLog(), { createLog: { error: 'One of the people you chose cannot write that memory.', values: { memoryId: 'm2', deciders: ['u2'] } } });
    const form = setupForm(m)!;
    expect(form.querySelector<HTMLSelectElement>('select[name=memoryId]')!.value).toBe('m2');
    expect([...form.querySelectorAll<HTMLInputElement>('input[name=deciders]')].map((b) => [b.value, b.checked])).toEqual([['u1', false], ['u2', true]]);
  });
  it('shows the chosen memory’s URN, for a single memory and for the selected one in a select', async () => {
    const single = await mount(noLog({ setup: { memories: [memory('m1', 'Team notes')], deciders: { people: [person('u1', 'Ada')], fixed: false }, viewer: person('u1', 'Ada') } }));
    expect(setupForm(single)!.textContent).toContain('acme.com:m1');
    const many = await mount(noLog(), { createLog: { error: 'x', values: { memoryId: 'm2', deciders: ['u1'] } } });
    expect(setupForm(many)!.textContent).toContain('acme.com:m2');
    expect(setupForm(many)!.textContent).not.toContain('acme.com:m1');
  });
  it('with members withheld there is no "choose at least one" (nobody to choose)', async () => {
    const m = await mount(noLog({ setup: { memories: [memory('m1', 'Team notes'), memory('m2', 'Runbooks')], deciders: { people: [person('u1', 'Ada')], fixed: true }, viewer: person('u1', 'Ada') } }));
    expect(setupForm(m)!.textContent).not.toContain('Choose at least one');
  });
  it('the checkboxes do not shrink beside a long name', async () => {
    const m = await mount(noLog());
    for (const b of setupForm(m)!.querySelectorAll('input[type=checkbox]')) expect(b.className).toMatch(/shrink-0/);
  });
  it('the set-deciders command is in code style', async () => {
    const m = await mount(withLog());
    expect([...m.target.querySelectorAll('code')].some((c) => c.textContent === 'hadron question log set-deciders')).toBe(true);
  });
});

describe('review nits', () => {
  it('while impersonating, no form: the action would refuse it, so the page says so up front', async () => {
    const m = await mount(noLog({ impersonating: 'Some User' }));
    expect(setupForm(m)).toBeNull();
    expect(text(m)).toContain('Questions cannot be set up while impersonating.');
  });
  it('a log with no deciders says so, not "Decided by: " with nothing after it', async () => {
    const m = await mount(withLog({ logs: { kind: 'ok', value: [log({ defaultDeciders: [] })] } }));
    expect(text(m)).toContain('No one is named to decide.');
    expect(text(m)).not.toMatch(/Decided by:\s*(To|$)/);
  });
});

describe('the log lines (a log exists)', () => {
  it('has no form, and names each log with its URN and who decides', async () => {
    const m = await mount(withLog());
    expect(setupForm(m)).toBeNull();
    const line = m.target.querySelector('[data-testid=question-log]')!;
    expect(line.textContent).toContain('Questions');
    expect(line.textContent).toContain('Decided by: Ada, Bob');
    expect(line.textContent).toContain('acme.com:team:questions');
    expect(line.querySelector('a')?.getAttribute('href')).toBe(log().portalUrl);
  });

  it('says how to change the deciders, in one short line', async () => {
    const m = await mount(withLog());
    expect(text(m)).toContain('To change who decides, use hadron question log set-deciders.');
  });

  it('shows the log line above the list, with rows below', async () => {
    const row = { id: 'q1', urn: 'u', portalUrl: 'https://x/q1', code: 'Q-1', title: 'T', state: 'OPEN', answered: false, priority: 'HIGH', tier: null, askedAt: null, answeredAt: null, revSeq: 1, viewerMayAnswer: true, answer: null, effectiveAssignee: null, askedBy: null };
    const m = await mount(withLog({ questions: { kind: 'ok', value: { total: 1, items: [row] } } }));
    const line = m.target.querySelector('[data-testid=question-log]')!;
    const table = m.target.querySelector('table')!;
    expect(line.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
