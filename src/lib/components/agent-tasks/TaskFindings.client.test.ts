import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick, wait } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import type { Finding, FindingsRead } from '$lib/agent-tasks/findings';
import TaskFindings from './TaskFindings.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); resetNavigationCalls(); });

const row = (id: string, text = `text ${id}`, severity = 'P2'): Finding => ({ id, severity, text });
const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(`F${from + i}`));
const page = (taskId: string, offset: number, items: Finding[], total: number, hasMore: boolean): FindingsRead => ({ kind: 'page', page: { taskId, offset, items, total, hasMore } });
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function deferred() { let resolve!: (r: Response) => void; const promise = new Promise<Response>((r) => { resolve = r; }); return { promise, resolve }; }
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u]) => String(u));

async function setup(initial: FindingsRead | Promise<FindingsRead>, taskId = 'task') {
  const props = reactiveProps({ appId: 'app', taskId, initial });
  const m = mountComponent(TaskFindings as never, props as never); mounted.push(m); await tick(5);
  return { ...m, props };
}
const button = (t: HTMLElement, label: string) => {
  const b = Array.from(t.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === label);
  expect(b, label).toBeDefined(); return b!;
};
const texts = (t: HTMLElement) => Array.from(t.querySelectorAll('[data-testid="finding-text"]')).map((e) => e.textContent);
const range = (t: HTMLElement) => t.querySelector('[data-testid="findings-range"]')?.textContent?.replace(/\s+/g, ' ').trim();
const status = (t: HTMLElement) => t.querySelector('[data-testid="findings-status"]')!;

describe('first page', () => {
  it('shows the loader read, a true range and total, and only the buttons that apply', async () => {
    const m = await setup(page('task', 0, rows(1, 20), 57, true));
    expect(texts(m.target)).toHaveLength(20);
    expect(range(m.target)).toBe('Showing findings 1 to 20 of 57');
    expect(button(m.target, 'Next').disabled).toBe(false);
    expect(button(m.target, 'Previous').disabled).toBe(true);
    expect(button(m.target, 'First').disabled).toBe(true);
  });
  it('is loading (not empty) until the loader answers, then applies it', async () => {
    let resolve!: (r: FindingsRead) => void;
    const m = await setup(new Promise<FindingsRead>((r) => { resolve = r; }));
    expect(m.target.querySelector('[data-testid="findings-loading"]')).not.toBeNull();
    expect(m.target.textContent).not.toContain('No recorded findings');
    resolve(page('task', 0, rows(1, 2), 2, false)); await tick(5);
    expect(texts(m.target)).toHaveLength(2); expect(m.target.querySelector('[data-testid="findings-loading"]')).toBeNull();
  });
  it('a legacy finished result is "No recorded findings" with the grid chrome still mounted', async () => {
    const m = await setup(page('task', 0, [], 0, false));
    expect(m.target.querySelector('[data-testid="findings-empty"]')?.textContent).toBe('No recorded findings');
    expect(m.target.querySelector('table')).not.toBeNull();
  });
  it('a rejected loader promise is a failure with Retry, never an empty section', async () => {
    const m = await setup(Promise.reject(new Error('x')));
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
    expect(m.target.textContent).not.toContain('No recorded findings');
    expect(m.target.querySelector('table')).toBeNull();
  });
});

describe('paging by the served page', () => {
  it('Next starts after the rows actually served, and a short page with hasMore still continues', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(page('task', 15, rows(16, 7), 40, true)))
      .mockResolvedValueOnce(reply(page('task', 22, rows(23, 18), 40, false)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 15), 40, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(urls(f)).toEqual(['/app/apps/app/tasks/task/findings?offset=15']);
    expect(range(m.target)).toBe('Showing findings 16 to 22 of 40');
    expect(button(m.target, 'Next').disabled).toBe(false);
    button(m.target, 'Next').click(); await tick(8);
    expect(urls(f)[1]).toBe('/app/apps/app/tasks/task/findings?offset=22');
    expect(button(m.target, 'Next').disabled).toBe(true);
  });
  it('Previous returns to the recorded earlier offsets, First returns to 0', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(page('task', 15, rows(16, 7), 40, true)))
      .mockResolvedValueOnce(reply(page('task', 22, rows(23, 18), 40, false)))
      .mockResolvedValueOnce(reply(page('task', 15, rows(16, 7), 40, true)))
      .mockResolvedValueOnce(reply(page('task', 0, rows(1, 15), 40, true)))
      .mockResolvedValueOnce(reply(page('task', 15, rows(16, 7), 40, true)))
      .mockResolvedValueOnce(reply(page('task', 0, rows(1, 15), 40, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 15), 40, true));
    for (const label of ['Next', 'Next', 'Previous', 'Previous']) { button(m.target, label).click(); await tick(8); }
    expect(urls(f).map((u) => u.split('=')[1])).toEqual(['15', '22', '15', '0']);
    button(m.target, 'Next').click(); await tick(8);
    button(m.target, 'First').click(); await tick(8);
    expect(urls(f).slice(4).map((u) => u.split('=')[1])).toEqual(['15', '0']);
    expect(range(m.target)).toBe('Showing findings 1 to 15 of 40');
  });
  it('makes exactly one request per click and no speculative or all-pages read', async () => {
    const f = vi.fn().mockResolvedValue(reply(page('task', 20, rows(21, 20), 100, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 100, true));
    await tick(10); expect(f).not.toHaveBeenCalled();
    button(m.target, 'Next').click(); await tick(8); expect(f).toHaveBeenCalledTimes(1);
  });
  it('an offset beyond the total (the list shrank) is a valid empty page that First recovers from', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(page('task', 20, [], 10, false))));
    const m = await setup(page('task', 0, rows(1, 20), 40, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-empty"]')?.textContent).toContain('10 recorded');
    expect(m.target.querySelector('table')).not.toBeNull(); expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull();
    expect(button(m.target, 'First').disabled).toBe(false); expect(button(m.target, 'Next').disabled).toBe(true);
  });
  it('a provider that does not advance (empty/repeated page with hasMore) fails instead of looping', async () => {
    const f = vi.fn().mockResolvedValue(reply(page('task', 20, rows(1, 20), 100, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 100, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
    expect(range(m.target)).toBe('Showing findings 1 to 20 of 100');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('a repeated page is refused wherever it recurs, not only next to itself', () => {
  it('F1-20@0, F21-40@20, then F1-20@40 fails (a nonadjacent cycle) and keeps page two as retained data', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(page('task', 20, rows(21, 20), 80, true)))
      .mockResolvedValueOnce(reply(page('task', 40, rows(1, 20), 80, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 80, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(range(m.target)).toBe('Showing findings 21 to 40 of 80');
    expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull();
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
    expect(range(m.target)).toBe('Showing findings 21 to 40 of 80');
  });
  it('positive control: Previous and First re-reading the SAME offsets are still accepted', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(page('task', 20, rows(21, 20), 80, true)))
      .mockResolvedValueOnce(reply(page('task', 0, rows(1, 20), 80, true)))
      .mockResolvedValueOnce(reply(page('task', 20, rows(21, 20), 80, true)))
      .mockResolvedValueOnce(reply(page('task', 40, rows(41, 20), 80, true)))
      .mockResolvedValueOnce(reply(page('task', 0, rows(1, 20), 80, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 80, true));
    button(m.target, 'Next').click(); await tick(8);
    button(m.target, 'Previous').click(); await tick(8);
    expect(range(m.target)).toBe('Showing findings 1 to 20 of 80');
    button(m.target, 'Next').click(); await tick(8);
    button(m.target, 'Next').click(); await tick(8);
    expect(range(m.target)).toBe('Showing findings 41 to 60 of 80');
    button(m.target, 'First').click(); await tick(8);
    expect(range(m.target)).toBe('Showing findings 1 to 20 of 80');
    expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull();
  });
});

describe('short provider pages: the repeated-row guard keys on absolute position', () => {
  it('0:20 rows, 20:7 rows, 27:13 rows, then Previous to 20 returns 20 ordered rows and is accepted', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(page('task', 20, rows(21, 7), 60, true)))
      .mockResolvedValueOnce(reply(page('task', 27, rows(28, 13), 60, true)))
      .mockResolvedValueOnce(reply(page('task', 20, rows(21, 20), 60, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 60, true));
    button(m.target, 'Next').click(); await tick(8);
    button(m.target, 'Next').click(); await tick(8);
    expect(range(m.target)).toBe('Showing findings 28 to 40 of 60');
    button(m.target, 'Previous').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull();
    expect(range(m.target)).toBe('Showing findings 21 to 40 of 60');
  });
  it('a known id at a different absolute position is still refused', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(page('task', 20, [row('F5'), ...rows(22, 6)], 60, true)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 60, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
  });
});

describe('failures are never empty, and Retry is the section\'s own', () => {
  it('a failed Next keeps the page only as retained data, never advances, and Retry repeats the same offset', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('private fault')).mockResolvedValueOnce(reply(page('task', 20, rows(21, 5), 25, false)));
    vi.stubGlobal('fetch', f);
    const m = await setup(page('task', 0, rows(1, 20), 25, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
    expect(m.target.textContent).not.toContain('private fault');
    expect(range(m.target)).toBe('Showing findings 1 to 20 of 25');
    // portal#2111 — the live region announces what the reader sees: the retained-page message, not the initial-failure one.
    expect(status(m.target).textContent).toBe(m.target.querySelector('[data-testid="findings-failed"]')!.firstChild!.textContent!.trim());
    expect(status(m.target).textContent).toContain('These are the findings you were already reading');
    button(m.target, 'Retry').click(); await tick(8);
    expect(urls(f)).toEqual(['/app/apps/app/tasks/task/findings?offset=20', '/app/apps/app/tasks/task/findings?offset=20']);
    expect(range(m.target)).toBe('Showing findings 21 to 25 of 25');
    expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull();
    button(m.target, 'Previous').click(); await tick(1);
  });
  it('an initial failure has no rows or count; Retry reads offset 0', async () => {
    const f = vi.fn().mockResolvedValue(reply(page('task', 0, rows(1, 3), 3, false)));
    vi.stubGlobal('fetch', f);
    const m = await setup({ kind: 'failed' });
    expect(m.target.querySelector('table')).toBeNull(); expect(range(m.target)).toBeUndefined();
    button(m.target, 'Retry').click(); await tick(8);
    expect(urls(f)).toEqual(['/app/apps/app/tasks/task/findings?offset=0']);
    expect(texts(m.target)).toHaveLength(3);
  });
  it.each([
    ['HTTP 500', () => reply({}, 500)], ['malformed JSON', () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }) as unknown as Response],
    ['{kind:"failed"}', () => reply({ kind: 'failed' })], ['a page for another task', () => reply(page('other', 20, rows(21, 2), 30, false))],
    ['a malformed page', () => reply({ kind: 'page', page: { taskId: 'task', offset: 20, items: null, total: 3, hasMore: false } })],
  ])('%s is a failure, not an empty page', async (_n, answer) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer()));
    const m = await setup(page('task', 0, rows(1, 20), 30, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
    expect(range(m.target)).toBe('Showing findings 1 to 20 of 30');
  });
  it('a failed Retry does not navigate, invalidate or touch the root error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const m = await setup({ kind: 'failed' });
    resetNavigationCalls();
    button(m.target, 'Retry').click(); await tick(8);
    expect(navigationCalls).toEqual([]); expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
  });
  it.each([[404], [403]])('a later %s clears the rows and says unavailable', async (statusCode) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ kind: 'unavailable' }, statusCode)));
    const m = await setup(page('task', 0, rows(1, 20), 30, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-unavailable"]')).not.toBeNull();
    expect(texts(m.target)).toEqual([]); expect(m.target.querySelector('table')).toBeNull();
  });
  it('a later no-result is its own state, not zero findings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ kind: 'no-result' })));
    const m = await setup(page('task', 0, rows(1, 20), 30, true));
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-no-result"]')).not.toBeNull();
    expect(m.target.textContent).not.toContain('No recorded findings'); expect(texts(m.target)).toEqual([]);
  });
});

describe('identity and request-generation fences', () => {
  it('a late page for task A never paints task B (and the current response does apply)', async () => {
    const hold = deferred(); const f = vi.fn().mockReturnValueOnce(hold.promise);
    vi.stubGlobal('fetch', f);
    const m = await setup(page('A', 0, rows(1, 20), 40, true), 'A');
    button(m.target, 'Next').click(); await tick(3);
    m.props.taskId = 'B'; m.props.initial = page('B', 0, [row('B1', 'B text')], 1, false); await tick(5);
    hold.resolve(reply(page('A', 20, rows(21, 20), 40, false))); await tick(8);
    expect(texts(m.target)).toEqual(['B text']); expect(range(m.target)).toBe('Showing findings 1 to 1 of 1');
    expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull(); expect(status(m.target).textContent).not.toContain('Couldn’t');
    // positive direction: B's own pager still applies its own current answer
    f.mockResolvedValueOnce(reply(page('B', 1, [row('B2', 'B two')], 2, false)));
    m.props.initial = page('B', 0, [row('B1', 'B text')], 5, true); await tick(5);
    button(m.target, 'Next').click(); await tick(8);
    expect(texts(m.target)).toEqual(['B two']);
  });
  it('navigating A to B resets rows, pager trail, loading and error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const m = await setup(page('A', 0, rows(1, 20), 40, true), 'A');
    button(m.target, 'Next').click(); await tick(8);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).not.toBeNull();
    m.props.taskId = 'B'; m.props.initial = new Promise<FindingsRead>(() => {}); await tick(5);
    expect(m.target.querySelector('[data-testid="findings-failed"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="findings-loading"]')).not.toBeNull(); expect(texts(m.target)).toEqual([]);
  });
  it('a new loader read for the same task supersedes a response still in flight', async () => {
    const hold = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(hold.promise));
    const m = await setup(page('task', 0, rows(1, 20), 40, true));
    button(m.target, 'Next').click(); await tick(3);
    m.props.initial = page('task', 0, [row('N1', 'fresh')], 1, false); await tick(5);
    hold.resolve(reply(page('task', 20, rows(21, 20), 40, false))); await tick(8);
    expect(texts(m.target)).toEqual(['fresh']);
  });
  it('a late loader answer for the previous identity is ignored', async () => {
    let late!: (r: FindingsRead) => void;
    const m = await setup(new Promise<FindingsRead>((r) => { late = r; }), 'A');
    m.props.taskId = 'B'; m.props.initial = page('B', 0, [row('B1', 'B text')], 1, false); await tick(5);
    late(page('A', 0, [row('A1', 'A text')], 1, false)); await tick(8);
    expect(texts(m.target)).toEqual(['B text']);
  });
  // portal#2111 (design §24) — the window between an identity change and the response that was in flight for the old one.
  // Traced under Svelte 5.56: the prop change runs the effect (begin -> generation bump) synchronously, ahead of a fetch
  // continuation that was already queued, so the generation half drops this answer and the identity half
  // (issuedApp/issuedTask) is defense in depth with no reachable window of its own. Removing EITHER half passes;
  // removing BOTH fails here: begin() resets every other piece of state, so the trace a stale accept leaves is the focus it moves.
  it('a response in flight when the App changes is dropped by the fence, and moves no focus', async () => {
    let m!: Awaited<ReturnType<typeof setup>>;
    const body = page('task', 20, rows(21, 20), 40, false);
    // A thenable body: resolving it first queues the fetch continuation, THEN the App change queues Svelte's flush behind it.
    const json = () => ({ then(resolve: (v: unknown) => void) { resolve(body); m.props.appId = 'other-app'; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json } as unknown as Response));
    m = await setup(page('task', 0, rows(1, 20), 40, true));
    const next = button(m.target, 'Next'); next.focus(); next.click(); await tick(10);
    expect(document.activeElement).not.toBe(m.target.querySelector('#findings-heading'));
    expect(texts(m.target)).toHaveLength(20); expect(range(m.target)).toBe('Showing findings 1 to 20 of 40');
  });
  it('unmounting while a fetch is pending aborts it and leaves no unhandled rejection', async () => {
    const hold = deferred(); let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => { signal = init.signal as AbortSignal; return hold.promise; }));
    const m = await setup(page('task', 0, rows(1, 20), 40, true));
    button(m.target, 'Next').click(); await tick(3);
    const caught = await captureUnhandledRejections(async () => { m.unmount(); hold.resolve(reply(page('task', 20, rows(21, 20), 40, false))); await wait(5); });
    expect(signal?.aborted).toBe(true); expect(caught).toEqual([]);
  });
});

describe('accessibility and focus', () => {
  it('marks the section busy while a page loads, keeps the live region mounted throughout, and focus on the initiating control', async () => {
    const hold = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise));
    const m = await setup(page('task', 0, rows(1, 20), 40, true));
    const live = status(m.target); expect(live.getAttribute('aria-live')).toBe('polite');
    const next = button(m.target, 'Next'); next.focus(); next.click(); await tick(3);
    expect(m.target.querySelector('section')!.getAttribute('aria-busy')).toBe('true');
    expect(status(m.target)).toBe(live); expect(live.textContent).toContain('Loading findings');
    expect(document.activeElement).toBe(next); expect(next.disabled).toBe(false);
    hold.resolve(reply(page('task', 20, rows(21, 20), 60, true))); await tick(8);
    expect(m.target.querySelector('section')!.getAttribute('aria-busy')).toBe('false');
    expect(status(m.target)).toBe(live); expect(live.textContent).toBe('Showing findings 21 to 40 of 60');
    expect(document.activeElement).toBe(button(m.target, 'Next'));
  });
  it('reaching the last page moves focus from the now-disabled Next to the Findings heading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(page('task', 20, rows(21, 5), 25, false))));
    const m = await setup(page('task', 0, rows(1, 20), 25, true));
    const next = button(m.target, 'Next'); next.focus(); next.click(); await tick(10);
    expect(button(m.target, 'Next').disabled).toBe(true);
    expect(document.activeElement).toBe(m.target.querySelector('#findings-heading'));
  });
  it('does not take focus on an initial or background load', async () => {
    const m = await setup(page('task', 0, rows(1, 3), 3, false));
    expect(document.activeElement).toBe(document.body); expect(m.target.contains(document.activeElement)).toBe(false);
  });
  it('does not steal focus the reader moved elsewhere while the page loaded', async () => {
    const hold = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise));
    const m = await setup(page('task', 0, rows(1, 20), 25, true));
    const other = document.createElement('button'); document.body.appendChild(other);
    const next = button(m.target, 'Next'); next.focus(); next.click(); await tick(3); other.focus();
    hold.resolve(reply(page('task', 20, rows(21, 5), 25, false))); await tick(10);
    expect(document.activeElement).toBe(other); other.remove();
  });
});

describe('text is literal', () => {
  it('renders hostile HTML/markdown/links as text with no executable DOM, and reveals controls', async () => {
    const hostile = '<script>window.__x=1</script><img src=x onerror="window.__x=1"> [a](javascript:1)‮evil\u001B';
    const m = await setup(page('task', 0, [row('F1', hostile, 'P1')], 1, false));
    expect(m.target.querySelector('script, img, a')).toBeNull();
    expect(texts(m.target)[0]).toBe('<script>window.__x=1</script><img src=x onerror="window.__x=1"> [a](javascript:1)[U+202E]evil[U+001B]');
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
  it('severity is the literal label and never changes anything else on the page', async () => {
    const m = await setup(page('task', 0, [row('F1', 't', 'P1'), row('F2', 't', 'note')], 2, false));
    expect(m.target.textContent).toContain('P1'); expect(m.target.textContent).toContain('note');
    expect(m.target.textContent).not.toMatch(/blocking|must fix|ready/i);
  });
  // portal#2111 — id and severity come from the same provider as text, so they get the same treatment.
  it('id and severity reveal controls and are bidi-isolated like text', async () => {
    const m = await setup(page('task', 0, [row('F\u202E1', 't', 'P\u20661\u2069')], 1, false));
    const id = m.target.querySelector<HTMLElement>('[data-testid="finding-id"]')!;
    const sev = m.target.querySelector<HTMLElement>('[data-testid="finding-severity"]')!;
    expect(id.textContent).toBe('F[U+202E]1'); expect(sev.textContent).toBe('P[U+2066]1[U+2069]');
    for (const el of [id, sev]) { expect(el.getAttribute('dir')).toBe('auto'); expect(el.className).toContain('[unicode-bidi:isolate]'); }
  });
  // portal#2119 / #2115 QA F1 — revealed markers (or a long unbroken label) widen severity; with no
  // break opportunity it painted over the Text cell. Every provider-served field carries its wrap class;
  // the geometry itself is measured by scripts/test-table-cell-overflow-layout.mjs (findings pass, portal#2118 item 5).
  it.each([
    ['revealed markers', 'sev-A\u2061B\u2062C\u2063D\u2064E\u2028F\u2029G'],
    ['a long unbroken plain label', 'S'.repeat(80)],
  ])('id, severity and text each carry their own wrap class (severity: %s)', async (_n, severity) => {
    const m = await setup(page('task', 0, [row('F1', 't', severity)], 1, false));
    const cls = (testid: string) => m.target.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.className.split(/\s+/);
    expect(cls('finding-id')).toContain('break-all');
    expect(cls('finding-severity')).toContain('[overflow-wrap:anywhere]');
    expect(cls('finding-text')).toContain('break-words');
  });
  it('keeps long multi-line text and every code point', async () => {
    const long = `line one\nline two ${'𝔘'.repeat(2000)}`;
    const m = await setup(page('task', 0, [row('F1', long)], 1, false));
    expect(texts(m.target)[0]).toBe(long);
  });
});
