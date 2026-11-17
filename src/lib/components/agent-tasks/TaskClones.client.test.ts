/**
 * portal#2161 — the Clones list's lifecycle lane (the #795 split: `render` from svelte/server
 * never mounts, so nothing here fits TaskClones.test.ts). SvelteKit reuses this component across
 * /tasks/[taskId] navigations — a clone link is exactly such a link — so the view must re-seed on
 * a task or App change, and a pending Load-more page must land only on the page it was issued
 * for. Both directions are pinned: the stale page is discarded, and the page it returns to still
 * adopts its own result (the TaskPlanning relation-fence pattern).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TaskClones from './TaskClones.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });

const basePath = '/app/apps/app-1';
const row = (id: string, title = `Task ${id}`) => ({ id, appId: 'app-1', handle: `AT3.${id}`, title, status: 'PENDING' });
const read = (items: ReturnType<typeof row>[], total: number, hasMore: boolean) => ({ kind: 'ok' as const, value: { items, total, hasMore } });

function setup(initial = read([row('1'), row('2')], 5, true), taskId = 't0') {
  const props = reactiveProps({ initial, appId: 'app-1', taskId, basePath });
  const m = mountComponent(TaskClones as never, props as never);
  mounted.push(m);
  return { ...m, props };
}
const more = (m: { target: HTMLElement }) => {
  const b = m.target.querySelector<HTMLButtonElement>('[data-testid="clones-more"]');
  expect(b).toBeDefined();
  return b!;
};
const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
function deferred() {
  let resolve!: (value: Response) => void;
  return { promise: new Promise<Response>((r) => { resolve = r; }), resolve: (body: unknown) => resolve(reply(body)) };
}

describe('TaskClones lifecycle (portal#2161)', () => {
  it('re-seeds on a task change: the new task’s clones replace the old one’s, not append', async () => {
    const m = setup();
    expect(m.target.textContent).toContain('Task 1');
    m.props.taskId = 't9';
    m.props.initial = read([row('7', 'Fresh clone')], 1, false);
    await tick(3);
    expect(m.target.textContent).toContain('Fresh clone');
    expect(m.target.textContent).not.toContain('Task 1');
    expect(m.target.textContent).not.toContain('Load more clones');
  });

  it('a task change without a fresh read is unknown, never the old task’s rows', async () => {
    const m = setup();
    const stale = m.props.initial;
    m.props.taskId = 't9';
    // Same read object: the loader did not answer for the new task.
    m.props.initial = stale;
    await tick(3);
    expect(m.target.textContent).toContain('Couldn’t load the clones. Reload the page to try again.');
    expect(m.target.textContent).not.toContain('Task 1');
  });

  it.each(['task', 'app'])('discards a pending Load-more page after the %s changes', async (change) => {
    const hold = deferred();
    const fetcher = vi.fn().mockReturnValue(hold.promise);
    vi.stubGlobal('fetch', fetcher);
    const m = setup();
    more(m).click();
    await tick();
    if (change === 'task') {
      m.props.taskId = 't9';
      m.props.initial = read([row('8', 'Own page')], 1, false);
    } else {
      m.props.appId = 'app-2';
    }
    await tick(3);
    hold.resolve(read([row('stale', 'Stale page')], 6, false));
    await tick(5);
    expect(m.target.textContent).not.toContain('Stale page');
    expect(m.target.textContent).not.toContain('Task 1');
    if (change === 'task') expect(m.target.textContent).toContain('Own page');
    expect(fetcher.mock.calls.length).toBe(1);
  });

  it('a page resolved for the page it was issued on is still adopted', async () => {
    const hold = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise));
    const m = setup();
    more(m).click();
    await tick(3);
    // No identity change meanwhile: the fence must not fence out the page's own result.
    hold.resolve(read([row('3', 'Third page')], 5, false));
    await tick(5);
    expect(m.target.textContent).toContain('Third page');
    expect(m.target.textContent).toContain('Task 1');
    expect(m.target.textContent).not.toContain('Load more clones');
    // Last page, 3 of 5 shown: the rest-hidden line, not a Load-more affordance.
    expect(m.target.textContent).toContain('2 clone(s) aren’t shown.');
  });

  it('an overlapping page (a concurrent clone write shifted the offsets) appends nothing and says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(read([row('1', 'Task 1 again')], 5, true))));
    const m = setup();
    more(m).click();
    await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load more clones. Try again.');
    // Still two rows, no duplicate-keyed each.
    expect(m.target.querySelectorAll('a[href$="/AT3.1"]').length).toBe(1);
    expect(m.target.textContent).toContain('Showing 2 of 5');
  });

  it('a foreign or malformed page is refused, keeping the earlier view', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ kind: 'ok', value: { items: [{ ...row('x', 'Foreign'), appId: 'app-2' }], total: 5, hasMore: false } })));
    const m = setup();
    more(m).click();
    await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load more clones. Try again.');
    expect(m.target.textContent).not.toContain('Foreign');
  });

  it('a pending page resolved after unmount touches nothing and rejects nobody', async () => {
    const hold = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(hold.promise));
    const m = setup();
    more(m).click();
    await tick();
    m.unmount();
    hold.resolve(read([row('late', 'Late page')], 6, false));
    await tick(5);
    expect(m.target.isConnected).toBe(false);
  });
});
