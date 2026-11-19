/** #2287 — two cues in the shared DataTable that promised something that was not there.
 *
 * 1. The footer's `aria-current="page"` span rendered unconditionally, with text only when there is
 *    more than one page: a "current page" item with no content on an empty or single-page table.
 * 2. With `sortButtons` the `<th>` has no click handler and only the inner button sorts, but the th
 *    still carried `cursor-pointer hover:...`, promising a target that did nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import TableCuesHarness from '$lib/test/TableCuesHarness.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function mountTable(props: { rowCount: number; sortButtons?: boolean }) {
  const m = mountComponent(TableCuesHarness as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

const footerCurrents = (t: HTMLElement) => [...t.querySelectorAll('[data-testid="table-footer"] [aria-current]')];
const nameTh = (t: HTMLElement) => [...t.querySelectorAll('thead th')].find((th) => th.textContent?.includes('Name')) as HTMLElement;
const idTh = (t: HTMLElement) => [...t.querySelectorAll('thead th')].find((th) => th.textContent?.includes('ID')) as HTMLElement;

describe('footer aria-current (#2287)', () => {
  it('zero rows: nothing in the footer is aria-current', () => {
    const t = mountTable({ rowCount: 0 });
    expect(t.querySelector('[data-testid="table-footer"]')).not.toBeNull();
    expect(footerCurrents(t)).toHaveLength(0);
  });

  it('one page: nothing in the footer is aria-current', () => {
    const t = mountTable({ rowCount: 5 });
    expect(footerCurrents(t)).toHaveLength(0);
  });

  it('several pages: exactly one element is aria-current="page", with the "Page x of y" text', () => {
    const t = mountTable({ rowCount: 25 });
    const current = footerCurrents(t);
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('aria-current')).toBe('page');
    expect(current[0].textContent).toBe('Page 1 of 2');
  });

  it('the span stays on an empty footer so the layout is unchanged', () => {
    const t = mountTable({ rowCount: 0 });
    const footer = t.querySelector('[data-testid="table-footer"]')!;
    expect(footer.firstElementChild?.tagName).toBe('SPAN');
  });
});

describe('sortable header pointer cue (#2287)', () => {
  it('sortButtons: no sortable th has cursor-pointer, and the header button does', () => {
    const t = mountTable({ rowCount: 3, sortButtons: true });
    const th = nameTh(t);
    expect(th.className).not.toMatch(/cursor-pointer/);
    expect(th.className).not.toMatch(/hover:text/);
    const button = th.querySelector('button')!;
    expect(button.className).toMatch(/cursor-pointer/);
    expect(button.className).toMatch(/hover:text/);
  });

  it('sortButtons: a column that cannot sort has no button and no pointer cue', () => {
    const t = mountTable({ rowCount: 3, sortButtons: true });
    expect(idTh(t).querySelector('button')).toBeNull();
    expect(idTh(t).className).not.toMatch(/cursor-pointer/);
  });

  it('no sortButtons: the th keeps its pointer cue and no inner button is added', () => {
    const t = mountTable({ rowCount: 3, sortButtons: false });
    const th = nameTh(t);
    expect(th.className).toMatch(/cursor-pointer/);
    expect(th.className).toMatch(/hover:text-zinc-700/);
    expect(th.querySelector('button')).toBeNull();
    expect(idTh(t).className).not.toMatch(/cursor-pointer/);
  });

  it('no sortButtons: click and keyboard on the th still sort', () => {
    const t = mountTable({ rowCount: 3, sortButtons: false });
    const th = nameTh(t);
    expect(th.getAttribute('aria-sort')).toBeNull();
    th.click();
    flushSync();
    expect(nameTh(t).getAttribute('aria-sort')).toBe('ascending');
    nameTh(t).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    flushSync();
    expect(nameTh(t).getAttribute('aria-sort')).toBe('descending');
    nameTh(t).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    flushSync();
    expect(nameTh(t).getAttribute('aria-sort')).toBeNull();
  });

  it('sortButtons: the header button sorts', () => {
    const t = mountTable({ rowCount: 3, sortButtons: true });
    nameTh(t).querySelector('button')!.click();
    flushSync();
    expect(nameTh(t).getAttribute('aria-sort')).toBe('ascending');
  });
});
