import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import TaskFindings from './TaskFindings.svelte';
import type { AgentTaskFinding, AgentTaskFindingPage, TaskFindingsRead } from '$lib/agent-tasks/findings';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetNavigationCalls();
  localStorage.clear();
});

const finding = (id: string, text = `Finding ${id}`): AgentTaskFinding => ({ id, severity: 'P2', text });
function page(offset: number, items: AgentTaskFinding[], hasMore: boolean, taskId = 'task-A', total = 45): AgentTaskFindingPage {
  return { taskId, offset, items, total, hasMore };
}
const read = (value: AgentTaskFindingPage): TaskFindingsRead => ({ kind: 'page', value });
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve: (body: unknown, status = 200) => resolve(reply(body, status)), reject };
}
function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
  expect(found, label).toBeDefined();
  return found!;
}
async function setup(initial: TaskFindingsRead | Promise<TaskFindingsRead> = read(page(0, [finding('F1'), finding('F2')], true))) {
  const props = reactiveProps({ appId: 'app-A', taskId: 'task-A', findings: Promise.resolve(initial) });
  const m = mountComponent(TaskFindings as never, props as never);
  mounted.push(m);
  await tick(6);
  return { ...m, props };
}
const urls = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.map((call) => String(call[0]));

describe('immutable findings pager (portal#1637)', () => {
  it('advances by served rows through a short continuation and returns through recorded offsets', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3')], true, 'task-A', 4))))
      .mockResolvedValueOnce(reply(read(page(3, [finding('F4')], false, 'task-A', 4))))
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3')], true, 'task-A', 4))))
      .mockResolvedValueOnce(reply(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 4))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 4)));

    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Finding F3');
    expect(button(m.target, 'Next').disabled).toBe(false); // short != end
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Finding F4');
    button(m.target, 'Previous').click(); await tick(6);
    button(m.target, 'Previous').click(); await tick(6);
    expect(urls(fetcher)).toEqual([
      '/app/apps/app-A/tasks/task-A/findings?offset=2',
      '/app/apps/app-A/tasks/task-A/findings?offset=3',
      '/app/apps/app-A/tasks/task-A/findings?offset=2',
      '/app/apps/app-A/tasks/task-A/findings?offset=0',
    ]);
    expect(m.target.textContent).toContain('1–2 of 4');
  });

  it('keeps the prior page explicitly retained after a failed Next, and Retry repeats that offset without navigation', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('private socket detail'))
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3')], false, 'task-A', 3))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 3)));
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Finding F1');
    expect(m.target.textContent).toContain('1–2 of 3');
    expect(m.target.textContent).toContain('Couldn’t load findings');
    expect(m.target.textContent).toContain('Retained the previous page');
    expect(m.target.querySelector('[data-findings-status]')?.textContent).toBe('');
    expect(m.target.querySelector('[data-findings-error]')?.textContent).toBe('Couldn’t load findings.');
    expect(m.target.textContent).not.toContain('private socket detail');
    expect(m.target.textContent).not.toContain('No recorded findings');
    button(m.target, 'Retry').click(); await tick(6);
    expect(urls(fetcher)).toHaveLength(2);
    expect(urls(fetcher)[0]).toBe(urls(fetcher)[1]);
    expect(m.target.textContent).toContain('Finding F3');
    expect(m.target.textContent).not.toContain('Finding F1');
    expect(navigationCalls).toEqual([]);
  });

  it('Retry preserves a failed First navigation and clears the offset history', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3'), finding('F4')], true, 'task-A', 5))))
      .mockResolvedValueOnce(reply(read(page(4, [finding('F5')], true, 'task-A', 5))))
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValueOnce(reply(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 5))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 5)));
    button(m.target, 'Next').click(); await tick(6);
    button(m.target, 'Next').click(); await tick(6);
    button(m.target, 'First').click(); await tick(6);
    expect(m.target.textContent).toContain('5–5 of 5');
    button(m.target, 'Retry').click(); await tick(6);
    expect(m.target.textContent).toContain('1–2 of 5');
    expect(button(m.target, 'First').disabled).toBe(true);
    expect(button(m.target, 'Previous').disabled).toBe(true);
  });

  it('Retry preserves a failed Previous navigation and pops exactly one offset', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3'), finding('F4')], true, 'task-A', 5))))
      .mockResolvedValueOnce(reply(read(page(4, [finding('F5')], true, 'task-A', 5))))
      .mockRejectedValueOnce(new Error('Previous failed'))
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3'), finding('F4')], true, 'task-A', 5))))
      .mockResolvedValueOnce(reply(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 5))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 5)));
    button(m.target, 'Next').click(); await tick(6);
    button(m.target, 'Next').click(); await tick(6);
    button(m.target, 'Previous').click(); await tick(6);
    button(m.target, 'Retry').click(); await tick(6);
    expect(m.target.textContent).toContain('3–4 of 5');
    button(m.target, 'Previous').click(); await tick(6);
    expect(urls(fetcher).at(-1)).toBe('/app/apps/app-A/tasks/task-A/findings?offset=0');
    expect(m.target.textContent).toContain('1–2 of 5');
    expect(button(m.target, 'Previous').disabled).toBe(true);
  });

  it('Retry still rejects a repeated Next page instead of bypassing the advance guard', async () => {
    const repeated = read(page(2, [finding('F1'), finding('F2')], true, 'task-A', 4));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(repeated))
      .mockResolvedValueOnce(reply(repeated))
      .mockResolvedValueOnce(reply(read(page(2, [finding('F3'), finding('F4')], false, 'task-A', 4))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 4)));
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Couldn’t load findings');
    button(m.target, 'Retry').click(); await tick(6);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(m.target.textContent).toContain('Finding F1');
    expect(m.target.textContent).toContain('Couldn’t load findings');
    button(m.target, 'Retry').click(); await tick(6);
    expect(m.target.textContent).toContain('Finding F3');
    expect(m.target.textContent).not.toContain('Couldn’t load findings');
  });

  it('retries an initial failed read without fabricating rows or a total', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(read(page(0, [], false, 'task-A', 0))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup({ kind: 'failed' });
    expect(m.target.textContent).toContain('Couldn’t load findings');
    expect(m.target.querySelector('table')).toBeNull();
    expect(m.target.textContent).not.toContain('0 of 0');
    button(m.target, 'Retry').click(); await tick(6);
    expect(urls(fetcher)).toEqual(['/app/apps/app-A/tasks/task-A/findings?offset=0']);
    expect(m.target.textContent).toContain('No recorded findings');
    expect(m.target.querySelector('table')).not.toBeNull();
  });

  it('keeps grid chrome and offers First/Previous recovery for a valid empty offset page', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(read(page(20, [], false, 'task-A', 20))))
      .mockResolvedValueOnce(reply(read(page(0, [finding('F1')], true, 'task-A', 20))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, Array.from({ length: 20 }, (_, i) => finding(`F${i}`)), true, 'task-A', 20)));
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.querySelector('table')).not.toBeNull();
    expect(m.target.textContent).toContain('No findings on this page');
    expect(m.target.textContent).toContain('20 total');
    expect(button(m.target, 'First').disabled).toBe(false);
    expect(button(m.target, 'Previous').disabled).toBe(false);
    expect(button(m.target, 'Next').disabled).toBe(true);
    button(m.target, 'First').click(); await tick(6);
    expect(urls(fetcher)[1]).toBe('/app/apps/app-A/tasks/task-A/findings?offset=0');
    expect(m.target.textContent).toContain('Finding F1');
  });

  it('clears retained rows on unavailable and treats malformed data as a failed read, never empty', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ kind: 'page', value: { items: null } }))
      .mockResolvedValueOnce(reply({ kind: 'unavailable' }));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Finding F1');
    expect(m.target.textContent).toContain('Couldn’t load findings');
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).not.toContain('Finding F1');
    expect(m.target.querySelector('table')).toBeNull();
    expect(m.target.textContent).toContain('Findings aren’t available');
  });

  it.each([403, 404])('clears retained rows on a later HTTP %s concealment', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(reply({}, status));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.querySelector('table')).toBeNull();
    expect(m.target.textContent).not.toContain('Finding F1');
    expect(m.target.textContent).toContain('Findings aren’t available');
    expect(m.target.querySelector('[data-findings-status]')?.textContent).toBe('');
    expect(m.target.querySelector('[data-findings-error]')?.textContent).toBe('Findings aren’t available for this task.');
  });

  it('omits the section when the initial read says the task result is gone', async () => {
    const m = await setup({ kind: 'no-result' });
    expect(m.target.querySelector('[data-testid="task-findings"]')).toBeNull();
  });

  it('keeps a later no-result section mounted, announces it, and restores focus', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ kind: 'no-result' }));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    const next = button(m.target, 'Next');
    next.focus();
    next.click();
    await tick(8);
    expect(m.target.querySelector('[data-testid="task-findings"]')).not.toBeNull();
    expect(m.target.querySelector('table')).toBeNull();
    expect(m.target.textContent).toContain('No task result is available.');
    expect(m.target.textContent).not.toContain('No recorded findings');
    expect(m.target.querySelector('[data-findings-status]')?.textContent).toBe('No task result is available.');
    expect(document.activeElement).toBe(m.target.querySelector('#task-findings-heading'));
  });

  it('rejects empty and repeated continuations without an automatic request loop', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(read(page(2, [], true))))
      .mockResolvedValueOnce(reply(read(page(2, [finding('F1'), finding('F2')], true))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Couldn’t load findings');
    button(m.target, 'Next').click(); await tick(6);
    expect(m.target.textContent).toContain('Finding F1');
    expect(m.target.textContent).toContain('Couldn’t load findings');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('discards A after task A → B, then applies B’s own current response', async () => {
    const old = deferred();
    const current = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    button(m.target, 'Next').click(); await tick();
    m.props.taskId = 'task-B';
    m.props.findings = Promise.resolve(read(page(0, [finding('B1')], true, 'task-B')));
    await tick(6);
    expect(m.target.textContent).toContain('Finding B1');
    old.resolve(read(page(2, [finding('STALE')], false)));
    await tick(6);
    expect(m.target.textContent).not.toContain('STALE');
    expect(m.target.textContent).toContain('Finding B1');
    button(m.target, 'Next').click(); await tick();
    current.resolve(read(page(1, [finding('B2')], false, 'task-B', 2)));
    await tick(6);
    expect(m.target.textContent).toContain('Finding B2');
    expect(m.target.textContent).not.toContain('STALE');
  });

  it('a new loader result for the same task supersedes an old request and its finally', async () => {
    const old = deferred();
    const current = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    button(m.target, 'Next').click(); await tick();
    m.props.findings = Promise.resolve(read(page(0, [finding('NEW')], true)));
    await tick(6);
    button(m.target, 'Next').click(); await tick();
    old.resolve(read(page(2, [finding('OLD')], false)));
    await tick(6);
    expect(m.target.textContent).not.toContain('OLD');
    expect(button(m.target, 'Next').disabled).toBe(true); // old finally did not clear current pending
    current.resolve(read(page(1, [finding('CURRENT')], false, 'task-A', 2)));
    await tick(6);
    expect(m.target.textContent).toContain('Finding CURRENT');
    expect(m.target.textContent).not.toContain('OLD');
  });

  it('moves focus to the persistent heading when the focused Next reaches the final page', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(read(page(2, [finding('F3')], false, 'task-A', 3))));
    vi.stubGlobal('fetch', fetcher);
    const m = await setup(read(page(0, [finding('F1'), finding('F2')], true, 'task-A', 3)));
    const next = button(m.target, 'Next'); next.focus(); next.click(); await tick(8);
    expect(document.activeElement).toBe(m.target.querySelector('#task-findings-heading'));
    expect(m.target.querySelector('[data-findings-status]')?.textContent).toContain('3–3 of 3');
  });

  it('aborts and consumes no late page after teardown', async () => {
    const hold = deferred();
    const consumed = vi.fn();
    const fetcher = vi.fn().mockReturnValue(hold.promise);
    vi.stubGlobal('fetch', fetcher);
    const m = await setup();
    button(m.target, 'Next').click(); await tick();
    const signal = fetcher.mock.calls[0][1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    m.unmount();
    expect(signal.aborted).toBe(true);
    hold.resolve({ kind: 'page', get value() { consumed(); return page(2, [finding('LATE')], false); } });
    await tick(6);
    expect(consumed).not.toHaveBeenCalled();
  });

  it('captures a late rejection after teardown instead of throwing into the void', async () => {
    const hold = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise));
    const m = await setup();
    button(m.target, 'Next').click(); await tick();
    const rejections = await captureUnhandledRejections(async () => {
      m.unmount();
      hold.reject(new Error('late rejection'));
      await tick(6);
    });
    expect(rejections).toEqual([]);
  });
});

describe('literal finding rendering', () => {
  it('escapes hostile markup and fake links, reveals controls, and preserves full Unicode text', async () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>[click](javascript:alert(3)) https://example.test';
    const unicode = '👩‍👩‍👧‍👦 ❤️ é a̐éö̲';
    const m = await setup(read(page(0, [finding('F1', `${hostile}\n${unicode}\u001b\u0007\r‮⁩`)], false, 'task-A', 1)));
    expect(m.target.querySelector('img, script, a[href^="javascript:"]')).toBeNull();
    expect(m.target.textContent).toContain(hostile);
    expect(m.target.textContent).toContain(unicode);
    expect(m.target.textContent).toContain('[U+001B][U+0007][U+000D][U+202E][U+2069]');
    expect(m.target.querySelector('input[type="text"]')).toBeNull();
    expect(m.target.querySelector('th[aria-sort]')).toBeNull();
  });
});
