import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const schema = { objectTypes: {
  task: { fields: { status: { type: 'enum', values: ['draft', 'live'] }, count: { type: 'number' }, enabled: { type: 'boolean' } } },
  other: { fields: { status: { type: 'text' } } },
} };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ nodes: [], total: 0 }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function browser() {
  const props = reactiveProps<Record<string, unknown>>({ nodes: [], basePath: '/app/memories/mem-a', memory: { id: 'mem-a', schema }, forcedView: 'nodes' });
  const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  [...m.target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().startsWith('Properties'))!.click();
  flushSync();
  return { ...m, props };
}
function pick(t: HTMLElement, selector: string, value: string) {
  const el = t.querySelector<HTMLSelectElement | HTMLInputElement>(selector);
  expect(el, selector).not.toBeNull();
  el!.value = value; el!.dispatchEvent(new Event(el!.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); flushSync();
}
function click(t: HTMLElement, label: string) {
  const b = [...t.querySelectorAll<HTMLButtonElement>('[data-testid="property-filter"] button')].find(b => b.textContent?.trim() === label);
  expect(b, label).toBeTruthy(); b!.click(); flushSync();
}
async function bodies() {
  await vi.advanceTimersByTimeAsync(400); await tick();
  return fetchMock.mock.calls.filter(([url]) => url === '/api/nodes/search').map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

async function finishResponse(resolve: (r: Response) => void, payload: unknown) {
  const response = new Response(JSON.stringify(payload));
  const json = response.json.bind(response);
  let parsed!: () => void;
  const consumed = new Promise<void>(r => { parsed = r; });
  vi.spyOn(response, 'json').mockImplementation(async () => {
    const result = await json(); parsed(); return result;
  });
  resolve(response);
  await consumed; // native body consumption, not a guessed number of ticks
  await tick(2);
}

function filter(t: HTMLElement) {
  pick(t, '#structured-object-type', 'task');
  pick(t, '[data-testid="property-filter-field"]', 'enabled');
  pick(t, '[data-testid="property-filter-value"]', 'false');
  click(t, 'Apply filter');
}

describe('#1221 MemoryBrowser typed filters', () => {
  it('sends typed false using the same server filter channel', async () => {
    const { target } = browser(); filter(target);
    const calls = await bodies();
    expect(calls.at(-1).filter).toMatchObject({ objectType: 'task', where: { path: ['enabled'], as: 'boolean', eq: false } });
  });
  it('collection change clears applied predicate and stale draft values', async () => {
    const { target } = browser(); filter(target); await bodies();
    pick(target, '#structured-object-type', 'other');
    const calls = await bodies();
    expect(calls.at(-1).filter).toMatchObject({ objectType: 'other', where: null });
    expect((target.querySelector('[data-testid="property-filter-field"]') as HTMLSelectElement).value).toBe('');
  });
  it('memory navigation clears schema-scoped selection before querying the new memory', async () => {
    const { target, props } = browser();
    pick(target, '[data-testid="approval-filter"]', 'APPROVED');
    filter(target); await bodies();
    props.basePath = '/app/memories/mem-b'; props.memory = { id: 'mem-b', schema }; flushSync();
    await bodies();
    const forB = (await bodies()).filter(b => b.memoryIds.includes('mem-b'));
    expect(forB.length).toBeGreaterThan(0);
    expect(forB.every(b => b.filter.where === null && b.filter.objectType === null)).toBe(true);
    expect((target.querySelector('#structured-object-type') as HTMLSelectElement).value).toBe('');
  });
});

// These exercise the mounted UI and actual serialized endpoint body, not just
// the helper's output. Every fetch assertion is scoped to the search endpoint.
describe('#1221 draft, advanced and refusal controls', () => {
  it('does not apply a partial number, then preserves zero', async () => {
    const { target } = browser();
    pick(target, '#structured-object-type', 'task'); await bodies();
    pick(target, '[data-testid="property-filter-field"]', 'count');
    const apply = () => [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Apply filter')!;
    expect(apply().disabled).toBe(true);
    pick(target, '[data-testid="property-filter-value"]', '1e309');
    expect(apply().disabled).toBe(true);
    expect((await bodies()).at(-1).filter.where).toBeNull();
    pick(target, '[data-testid="property-filter-value"]', '0');
    click(target, 'Apply filter');
    expect((await bodies()).at(-1).filter.where).toEqual({ path: ['count'], as: 'number', eq: 0 });
  });

  it('keeps complex raw predicates unchanged, invalid edits unapplied, and clear explicit', async () => {
    const { target } = browser();
    pick(target, '#structured-object-type', 'task');
    click(target, 'Advanced JSON');
    const complex = '{"or":[{"path":["enabled"],"as":"boolean","eq":false},{"path":["count"],"as":"number","gte":0}]}';
    pick(target, '#structured-where', complex);
    click(target, 'Apply filter');
    expect((await bodies()).at(-1).filter.where).toEqual(JSON.parse(complex));
    const fields = [...target.querySelectorAll<HTMLButtonElement>('[data-testid="property-filter"] button')].find(b => b.textContent?.trim() === 'Fields')!;
    expect(fields.disabled).toBe(true);
    const count = fetchMock.mock.calls.length;
    pick(target, '#structured-where', '{');
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Invalid edits have not been applied');
    expect([...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Apply filter')!.disabled).toBe(true);
    await bodies(); expect(fetchMock.mock.calls.length).toBe(count);
    click(target, 'Clear filter');
    expect((await bodies()).at(-1).filter.where).toBeNull();
    expect(fields.disabled).toBe(false);
  });

  it('switches applied field predicates to raw and back without applying stale draft values', async () => {
    const { target } = browser(); filter(target); await bodies();
    click(target, 'Advanced JSON');
    expect((target.querySelector('#structured-where') as HTMLTextAreaElement).value).toContain('false');
    click(target, 'Fields');
    expect((target.querySelector('[data-testid="property-filter-value"]') as HTMLSelectElement).value).toBe('false');
    pick(target, '[data-testid="property-filter-value"]', 'true');
    expect([...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Advanced JSON')!.disabled).toBe(true);
    expect((await bodies()).at(-1).filter.where.eq).toBe(false);
    click(target, 'Clear filter');
    expect((await bodies()).at(-1).filter.where).toBeNull();
    click(target, 'Advanced JSON');
    expect((target.querySelector('#structured-where') as HTMLTextAreaElement).value).toBe('');
  });

  it('retains server validation refusal text for applied raw grammar', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'where nesting exceeds max depth 4' }), { status: 400 }));
    const { target } = browser();
    click(target, 'Advanced JSON');
    pick(target, '#structured-where', '{"and":[]}'); click(target, 'Apply filter');
    expect((await bodies()).at(-1).filter.where).toEqual({ and: [] });
    expect(target.textContent).toContain('where nesting exceeds max depth 4');
  });

  it('a malformed schema offers only Advanced without reinterpreting raw text', async () => {
    const { target, props } = browser();
    props.memory = { id: 'mem-a', schema: { objectTypes: { task: { fields: { broken: { type: 'object' } } } } } }; flushSync();
    expect(target.querySelector('[data-testid="property-filter-field"]')).toBeNull();
    expect(target.querySelector('#structured-where')).not.toBeNull();
  });

  it('invalidates late results immediately on collection change, before the next request begins', async () => {
    let resolve!: (v: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const { target } = browser(); filter(target);
    await vi.advanceTimersByTimeAsync(350); await tick();
    expect(resolve).toBeTypeOf('function');
    pick(target, '#structured-object-type', 'other');
    await finishResponse(resolve, { nodes: [{ id: 'stale', memoryId: 'mem-a', loc: 'stale-only', name: 'Stale filtered result', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null }], total: 1 });
    expect(target.textContent).not.toContain('1 result');
    expect((await bodies()).at(-1).filter).toMatchObject({ objectType: 'other', where: null });
  });
});

describe('#1221 memory generation fence', () => {
  it('does not accept an old A result after A→B→A, before the replacement fetch', async () => {
    let resolve!: (v: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const { target, props } = browser(); filter(target);
    await vi.advanceTimersByTimeAsync(350); await tick();
    props.basePath = '/app/memories/mem-b'; props.memory = { id: 'mem-b', schema }; flushSync();
    props.basePath = '/app/memories/mem-a'; props.memory = { id: 'mem-a', schema }; flushSync();
    await finishResponse(resolve, { nodes: [{ id: 'old-a', memoryId: 'mem-a', loc: 'old-a', name: 'Old A filtered result', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null }], total: 1 });
    expect(target.textContent).not.toContain('1 result');
    expect((target.querySelector('#structured-object-type') as HTMLSelectElement).value).toBe('');
  });
});


it('positive control: the same response row is visible when it is current', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ nodes: [{ id: 'stale', memoryId: 'mem-a', loc: 'stale-only', name: 'Stale filtered result', nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null }], total: 1 })));
  const { target } = browser(); filter(target); await bodies();
  expect(target.textContent).toContain('1 result');
});


it('Clear all also discards invalid unapplied Advanced drafts', async () => {
  const { target } = browser();
  pick(target, '[data-testid="approval-filter"]', 'APPROVED');
  pick(target, '#structured-where', '{');
  const clear = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Clear all')!;
  expect(clear).toBeTruthy(); clear.click(); flushSync();
  [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().startsWith('Properties'))!.click(); flushSync();
  expect((target.querySelector('#structured-where') as HTMLTextAreaElement).value).toBe('');
  expect(target.querySelector('[data-testid="property-filter"] [role="alert"]')).toBeNull();
});


it('the Properties Clear resets an invalid draft even when its applied value was already empty', async () => {
  const { target } = browser();
  pick(target, '#structured-sort-path', 'priority');
  pick(target, '#structured-where', '{');
  const clear = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Clear')!;
  expect(clear).toBeTruthy(); clear.click(); flushSync();
  expect((target.querySelector('#structured-where') as HTMLTextAreaElement).value).toBe('');
  expect(target.querySelector('[data-testid="property-filter"] [role="alert"]')).toBeNull();
});


describe('#1221 review draft regressions', () => {
  it('preserves a draft on equal schema refresh, reseeds on changed declarations', () => {
    const { target, props } = browser();
    pick(target, '#structured-object-type', 'task');
    pick(target, '[data-testid="property-filter-field"]', 'count');
    pick(target, '[data-testid="property-filter-value"]', '42');
    props.memory = { id: 'mem-a', schema: JSON.parse(JSON.stringify(schema)) }; flushSync();
    expect((target.querySelector('[data-testid="property-filter-field"]') as HTMLSelectElement).value).toBe('count');
    expect((target.querySelector('[data-testid="property-filter-value"]') as HTMLInputElement).value).toBe('42');
    props.memory = { id: 'mem-a', schema: { objectTypes: { task: { fields: { title: { type: 'text' } } } } } }; flushSync();
    expect((target.querySelector('[data-testid="property-filter-field"]') as HTMLSelectElement).value).toBe('');
  });
  it('discards invalid draft without clearing the applied predicate or sending a request', async () => {
    const { target } = browser(); filter(target); await bodies();
    click(target, 'Advanced JSON');
    pick(target, '#structured-where', '{');
    const before = fetchMock.mock.calls.length;
    click(target, 'Discard changes');
    expect(JSON.parse((target.querySelector('#structured-where') as HTMLTextAreaElement).value)).toEqual({ path: ['enabled'], as: 'boolean', eq: false });
    expect(target.querySelector('[data-testid="property-filter"] [role="alert"]')).toBeNull();
    await bodies(); expect(fetchMock.mock.calls.length).toBe(before);
    click(target, 'Fields');
    expect((target.querySelector('[data-testid="property-filter-value"]') as HTMLSelectElement).value).toBe('false');
    pick(target, '[data-testid="property-filter-field"]', 'count');
    pick(target, '[data-testid="property-filter-value"]', 'invalid');
    click(target, 'Discard changes');
    expect((target.querySelector('[data-testid="property-filter-field"]') as HTMLSelectElement).value).toBe('enabled');
    expect((target.querySelector('[data-testid="property-filter-value"]') as HTMLSelectElement).value).toBe('false');
  });
});


it('preserves unapplied Advanced text when an equal schema reloads', () => {
  const { target, props } = browser(); filter(target);
  click(target, 'Advanced JSON'); pick(target, '#structured-where', '{');
  props.memory = { id: 'mem-a', schema: JSON.parse(JSON.stringify(schema)) }; flushSync();
  expect((target.querySelector('#structured-where') as HTMLTextAreaElement).value).toBe('{');
  expect(target.querySelector('[data-testid="property-filter"] [role="alert"]')).not.toBeNull();
});

describe('#1280 keyboard focus and filter feedback', () => {
  it('returns keyboard focus to the first editor control after Discard removes the button', async () => {
    const { target } = browser();
    pick(target, '#structured-object-type', 'task');
    pick(target, '[data-testid="property-filter-field"]', 'count');
    pick(target, '[data-testid="property-filter-value"]', '7');
    const discard = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Discard changes')!;
    discard.focus(); expect(document.activeElement).toBe(discard);
    discard.click(); flushSync(); await tick();
    expect(discard.isConnected).toBe(false);
    expect(document.activeElement).toBe(target.querySelector('[data-testid="property-filter-field"]'));
  });

  it('keeps one feedback region mounted through Apply, collection reset and explicit Clear', async () => {
    const { target } = browser();
    const status = target.querySelector('[data-testid="property-filter-status"]');
    expect(status).not.toBeNull();
    expect(status!.getAttribute('aria-live')).toBe('polite');
    expect(status!.textContent?.trim()).toBe('');
    filter(target); await bodies();
    expect(status!.textContent).toContain('Filter applied');
    pick(target, '#structured-object-type', 'other'); await bodies();
    expect(target.querySelector('[data-testid="property-filter-status"]')).toBe(status);
    expect(status!.textContent).toContain('Filter cleared because the collection changed');
    pick(target, '#structured-object-type', 'task');
    expect(status!.textContent?.trim()).toBe(''); // no applied predicate was cleared
    filter(target); click(target, 'Clear filter'); await bodies();
    expect(status!.textContent).toContain('Filter cleared');
    expect((await bodies()).at(-1).filter.where).toBeNull();
  });
});
