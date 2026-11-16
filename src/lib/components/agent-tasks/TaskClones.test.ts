/**
 * portal#2161 — the Clones list on a task's page (hadron-server#3244,
 * hrn:node:hadronmemory.com:specs:cor:agt:050:02 / hrn:node:hadronmemory.com:specs:cor:api:120:04): the tasks
 * cloned from this one, paged — the list offers the further pages and never
 * presents page one as the whole set. Nothing renders when the list is empty;
 * a failed read is unknown, never none, and says so.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskClones from './TaskClones.svelte';

const basePath = '/app/apps/app-1';
const row = (n: string, title: string) => ({ id: `t${n}`, appId: 'app-1', handle: `AT3.${n}`, title, status: 'PENDING' });
const html = (initial: unknown) =>
  render(TaskClones as never, { props: { initial, appId: 'app-1', taskId: 't0', basePath } } as never).body;
const page = (items: unknown[], total: number, hasMore: boolean) => ({ kind: 'ok', value: { items, total, hasMore } });

describe('TaskClones (acceptance 7)', () => {
  it('renders nothing when the list is empty', () => {
    const out = html(page([], 0, false));
    expect(out).not.toContain('data-testid="task-clones"');
    expect(out).not.toContain('Clones');
  });

  it('lists each clone as a link with its handle', () => {
    const out = html(page([row('1', 'First'), row('2', 'Second')], 2, false));
    expect(out).toContain('data-testid="task-clones"');
    expect(out).toMatch(/href="\/app\/apps\/app-1\/tasks\/AT3\.1"[^>]*>First</);
    expect(out).toMatch(/href="\/app\/apps\/app-1\/tasks\/AT3\.2"[^>]*>Second</);
    expect(out).not.toContain('Load more clones');
  });

  it('offers the next page when hasMore is true, never page one as the whole set', () => {
    const out = html(page([row('1', 'First'), row('2', 'Second')], 5, true));
    expect(out).toContain('data-testid="clones-more"');
    expect(out).toContain('Load more clones');
    expect(out).toContain('Showing 2 of 5');
  });

  it('a last page that holds fewer than the total says how many aren’t shown', () => {
    const out = html(page([row('1', 'First')], 3, false));
    expect(out).not.toContain('Load more clones');
    expect(out).toContain('2 clone(s) aren’t shown.');
  });

  it('a failed read is unknown, never none: the alert says reload', () => {
    const out = html({ kind: 'failed' });
    expect(out).toMatch(/role="alert"/);
    expect(out).toContain('Couldn’t load the clones. Reload the page to try again.');
    expect(out).not.toContain('data-testid="clones-more"');
  });
});
