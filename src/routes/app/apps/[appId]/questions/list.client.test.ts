/**
 * portal#2235 — the Questions list on screen: eight columns, links copied from the server's portalUrl, three different
 * empty states, one status region, a GET form that carries the rest of the view.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const person = (id: string, name: string) => ({ id, name, handle: name.toLowerCase() });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'q1', urn: 'hrn:node:acme.com:team:questions:q-1', portalUrl: 'https://hadronmemory.com/app/u/hrn:node:acme.com:team:questions:q-1',
  code: 'Q-1', title: 'Ship the migration?', state: 'OPEN', answered: false, priority: 'HIGH', tier: 'DEFAULT',
  askedAt: '2026-11-20T10:00:00Z', answeredAt: null, revSeq: 1, viewerMayAnswer: true, answer: null,
  effectiveAssignee: person('u2', 'Bob'),
  askedBy: { user: null, worker: { id: 'w1', name: 'Beryl', urn: 'hrn:worker:acme.com:team:beryl' }, app: null },
  ...over,
});
const filter = (over: Record<string, unknown> = {}) => ({ status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0, ...over });
const data = (over: Record<string, unknown> = {}) => ({
  app: { id: 'a1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  filter: filter(), viewerId: 'u1', impersonating: null,
  questions: { kind: 'ok', value: { total: 2, items: [row(), row({ id: 'q2', code: 'Q-2', title: 'Rotate the key?', effectiveAssignee: null, state: 'DECIDED', answered: true, answeredAt: '2026-11-21T09:00:00Z', answer: { key: 'yes', text: null, at: '2026-11-21T09:00:00Z' }, portalUrl: 'https://hadronmemory.com/app/u/q-2' })] } },
  logs: null,
  people: { people: [person('u1', 'Ada'), person('u2', 'Bob')], withheld: false, failed: false },
  navigation: { offset: 0, count: 2, total: 2, previousHref: null, nextHref: null },
  ...over,
});
async function mount(over: Record<string, unknown> = {}) {
  const m = mountComponent(Page as never, { data: data(over) } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
const text = (m: Mounted<any>) => m.target.textContent!.replace(/\s+/g, ' ');
const status = (m: Mounted<any>) => [...m.target.querySelectorAll('[role=status]')];
const emptyOf = (over: Record<string, unknown>) => ({ questions: { kind: 'ok', value: { total: 0, items: [] } }, navigation: { offset: 0, count: 0, total: 0, previousHref: null, nextHref: null }, ...over });

describe('rows', () => {
  it('renders the eight columns', async () => {
    const m = await mount();
    const heads = [...m.target.querySelectorAll('thead th')].map((th) => th.textContent!.replace(/[^\p{L} ]/gu, '').trim());
    for (const h of ['Code', 'Question', 'Priority', 'Status', 'For', 'Asked by', 'Asked', 'Answer']) expect(heads, h).toContain(h);
    expect(m.target.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('links the code and the title to the row’s portalUrl, copied not built', async () => {
    const m = await mount();
    const links = [...m.target.querySelectorAll<HTMLAnchorElement>('tbody a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toContainEqual(['Q-1', row().portalUrl]);
    expect(links).toContainEqual(['Ship the migration?', row().portalUrl]);
    expect(links).toContainEqual(['Q-2', 'https://hadronmemory.com/app/u/q-2']);
  });

  it('shows the effective assignee, or "Any decider" for an unassigned row', async () => {
    const m = await mount();
    const rows = [...m.target.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('Bob');
    expect(rows[1].textContent).toContain('Any decider');
    expect(rows[0].textContent).not.toContain('Any decider');
  });

  it('shows the asker by name with its URN, the status in words, and the answer only when there is one', async () => {
    const m = await mount();
    const [a, b] = [...m.target.querySelectorAll('tbody tr')];
    expect(a.textContent).toContain('Beryl');
    expect(a.textContent).toContain('acme.com:team:beryl'); // the Urn chip: type badge, then the rest
    expect(a.textContent).toContain('Pending');
    expect(b.textContent).toContain('Decided');
    expect(b.textContent).toContain('yes');
    expect(a.querySelector('[data-testid=question-answer]')?.textContent?.trim() ?? '').toBe('');
  });

  it('labels the states the filter cannot reach, too', async () => {
    const m = await mount({ filter: filter({ status: 'all' }), questions: { kind: 'ok', value: { total: 3, items: [row({ state: 'WITHDRAWN' }), row({ id: 'q3', state: 'TAMPERED' }), row({ id: 'q4', state: 'UNVERIFIABLE' })] } } });
    expect(text(m)).toContain('Withdrawn');
    expect(text(m)).toContain('Changed outside Hadron');
    expect(text(m)).toContain('Cannot be verified');
  });

  it('does not enable client-side column sorting, which would sort only this page', async () => {
    const m = await mount();
    expect(m.target.querySelectorAll('thead [aria-sort], thead button[aria-label*="Sort" i]').length).toBe(0);
  });
});

describe('one status region', () => {
  it('holds the count', async () => {
    const m = await mount({ questions: { kind: 'ok', value: { total: 12, items: [row()] } } });
    expect(status(m).length).toBe(1);
    expect(status(m)[0].textContent).toContain('12 questions');
  });
  it('says "1 question" in the singular', async () => {
    const m = await mount({ questions: { kind: 'ok', value: { total: 1, items: [row()] } } });
    expect(status(m)[0].textContent).toContain('1 question');
    expect(status(m)[0].textContent).not.toContain('1 questions');
  });
  it('a failed read is shown as a failure, never as an empty list', async () => {
    const m = await mount({ questions: { kind: 'failed' } });
    expect(m.target.querySelector('[role=alert]')?.textContent).toMatch(/Couldn.t load questions/);
    expect(text(m)).not.toContain('No questions');
  });
});

describe('the three empty states', () => {
  it('no question log: says agents cannot ask, and names the CLI', async () => {
    const m = await mount(emptyOf({ logs: { kind: 'ok', value: [] } }));
    expect(status(m)[0].textContent).toContain('This App has no question log yet, so its agents cannot ask questions.');
    expect(status(m)[0].textContent).toContain('hadron question log create');
  });
  it('logs exist, filters match nothing: "No questions match." with a link that clears the filters', async () => {
    const m = await mount(emptyOf({ logs: { kind: 'ok', value: [{ id: 'l1' }] }, filter: filter({ sort: 'newest' }) }));
    expect(status(m)[0].textContent).toContain('No questions match.');
    const clear = [...m.target.querySelectorAll<HTMLAnchorElement>('a')].find((a) => /clear/i.test(a.textContent ?? ''));
    // The sort is not a filter, so clearing the filters keeps it.
    expect(clear?.getAttribute('href')).toBe('/app/apps/a1/questions?status=all&assignee=all&sort=newest');
  });
  it('logs exist and nothing was ever asked (status all, everyone, no priority): "No questions have been asked yet."', async () => {
    const m = await mount(emptyOf({ logs: { kind: 'ok', value: [{ id: 'l1' }] }, filter: filter({ status: 'all', assignee: { kind: 'all' } }) }));
    expect(status(m)[0].textContent).toContain('No questions have been asked yet.');
    expect(status(m)[0].textContent).not.toContain('No questions match.');
  });
  it('the three texts are different', async () => {
    const a = status(await mount(emptyOf({ logs: { kind: 'ok', value: [] } })))[0].textContent;
    const b = status(await mount(emptyOf({ logs: { kind: 'ok', value: [{ id: 'l' }] } })))[0].textContent;
    const c = status(await mount(emptyOf({ logs: { kind: 'ok', value: [{ id: 'l' }] }, filter: filter({ status: 'all', assignee: { kind: 'all' } }) })))[0].textContent;
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it('an empty page with a failed log read says it could not tell, not "no log"', async () => {
    const m = await mount(emptyOf({ logs: { kind: 'failed' } }));
    expect(text(m)).not.toContain('no question log');
    expect(m.target.querySelector('[role=alert]')).not.toBeNull();
  });
  it('not a participant: the not-found treatment, no list', async () => {
    const m = await mount({ questions: { kind: 'not-participant' } });
    expect(m.target.querySelector('table')).toBeNull();
    expect(text(m)).toMatch(/take part/i);
  });
});

describe('the filter controls', () => {
  it('status links carry aria-current on the active one only', async () => {
    const m = await mount({ filter: filter({ status: 'answered' }) });
    const nav = m.target.querySelector('nav[aria-label="Filter questions by status"]')!;
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((a) => a.textContent!.trim())).toEqual(['Pending', 'Answered', 'All']);
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent!.trim())).toEqual(['Answered']);
  });

  it('a status link keeps the rest of the view and starts from the first page', async () => {
    const m = await mount({ filter: filter({ sort: 'newest', priority: ['high'], offset: 50 }) });
    const all = [...m.target.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Filter questions by status"] a')].find((a) => a.textContent!.trim() === 'All')!;
    expect(all.getAttribute('href')).toBe('/app/apps/a1/questions?status=all&sort=newest&priority=high');
  });

  it('the GET form carries the status as a hidden input and has the three selects', async () => {
    const m = await mount({ filter: filter({ status: 'answered' }) });
    const form = m.target.querySelector<HTMLFormElement>('form[method=GET]')!;
    const sent = [...new FormData(form).entries()].map(([k, v]) => [k, String(v)]);
    expect(sent).toContainEqual(['status', 'answered']);
    expect(sent.map(([k]) => k).sort()).toEqual(['assignee', 'priority', 'sort', 'status']);
    expect(form.querySelectorAll('select').length).toBe(3);
    for (const s of form.querySelectorAll('select')) expect(m.target.querySelector(`label[for="${s.id}"]`), s.name).not.toBeNull();
  });

  it('the assignee select offers Mine and unassigned, Everyone, then each member by name', async () => {
    const m = await mount();
    const opts = [...m.target.querySelectorAll<HTMLOptionElement>('select[name=assignee] option')].map((o) => [o.value, o.textContent!.trim()]);
    expect(opts).toEqual([['me', 'Mine and unassigned'], ['all', 'Everyone'], ['u1', 'Ada'], ['u2', 'Bob']]);
    expect(m.target.querySelector<HTMLSelectElement>('select[name=assignee]')!.value).toBe('me');
  });

  it('withheld members: only the two fixed choices', async () => {
    const m = await mount({ people: { people: [], withheld: true, failed: false } });
    const opts = [...m.target.querySelectorAll<HTMLOptionElement>('select[name=assignee] option')].map((o) => o.value);
    expect(opts).toEqual(['me', 'all']);
  });

  it('an assignee in the URL who is not in the list still shows, so the select never lies about the view', async () => {
    const m = await mount({ filter: filter({ assignee: { kind: 'user', id: 'u9' } }) });
    const select = m.target.querySelector<HTMLSelectElement>('select[name=assignee]')!;
    expect(select.value).toBe('u9');
  });

  it('the sort select offers the four sorts', async () => {
    const m = await mount();
    const opts = [...m.target.querySelectorAll<HTMLOptionElement>('select[name=sort] option')].map((o) => o.value);
    expect(opts).toEqual(['priority', 'newest', 'oldest', 'answered']);
  });
});

describe('paging', () => {
  it('draws the shared pager from the server total', async () => {
    const m = await mount({ navigation: { offset: 0, count: 50, total: 120, previousHref: null, nextHref: '/app/apps/a1/questions?offset=50' } });
    expect(m.target.querySelector<HTMLAnchorElement>('a[rel=next]')?.getAttribute('href')).toBe('/app/apps/a1/questions?offset=50');
  });
});

// Review findings on the first head (BLIND P2 x3, UX P2 and P3).
describe('review findings', () => {
  it('a page past the end says so and offers the first page, never "nothing has been asked"', async () => {
    const m = await mount(emptyOf({
      logs: { kind: 'ok', value: [{ id: 'l1' }] }, filter: filter({ status: 'all', assignee: { kind: 'all' }, offset: 150 }),
      questions: { kind: 'ok', value: { total: 120, items: [] } }, navigation: { offset: 150, count: 0, total: 120, previousHref: '/p?offset=100', nextHref: null },
    }));
    expect(status(m)[0].textContent).toContain('No questions on this page.');
    expect(status(m)[0].textContent).not.toContain('No questions have been asked yet.');
    const first = [...m.target.querySelectorAll<HTMLAnchorElement>('a')].find((a) => /first page/i.test(a.textContent ?? ''));
    expect(first?.getAttribute('href')).toBe('/app/apps/a1/questions?status=all&assignee=all');
  });

  it('a log read that answers not-participant shows the not-participant note, not a blank page', async () => {
    const m = await mount(emptyOf({ logs: { kind: 'not-participant' } }));
    expect(m.target.querySelector('[data-testid=questions-not-participant]')).not.toBeNull();
    expect(m.target.querySelector('form')).toBeNull();
  });

  it('the filters apply with a button that is always there, and no select submits by itself (WCAG 3.2.2)', async () => {
    const m = await mount();
    const form = m.target.querySelector<HTMLFormElement>('form[method=GET]')!;
    expect(form.querySelector('button[type=submit]')?.textContent?.trim()).toBe('Apply');
    let submits = 0;
    form.addEventListener('submit', (e) => { e.preventDefault(); submits += 1; });
    const select = form.querySelector<HTMLSelectElement>('select[name=priority]')!;
    select.value = 'urgent';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    expect(submits).toBe(0);
  });

  it('draws no pager under an empty first page ("0 of 0")', async () => {
    const m = await mount(emptyOf({ logs: { kind: 'ok', value: [{ id: 'l1' }] } }));
    expect(m.target.textContent).not.toMatch(/0\s+of\s+0/);
  });

  it('formats dates with the portal’s shared formatter and 24-hour time', async () => {
    const m = await mount();
    expect(text(m)).toMatch(/Nov \d+, 2026, \d\d:\d\d:\d\d/) // zone-independent: the shared formatter, seconds included;
  });
});
