/** #1270 — NodeList carries the third copy of the pagination footer the
 * shared DataTable extraction was meant to retire. That copy must wrap the
 * same way the shared one now does: the "Nodes per page" select is sized by
 * its longest option label and cannot shrink beside Previous/Next, so a
 * no-wrap footer pushes the document wide on a 390px phone.
 *
 * jsdom does not lay out, so this pins the wrap contract on the rendered
 * markup; the geometry evidence is the browser receipt in the PR.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import NodeList from './NodeList.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

// Same minimal node shape NodeList.test.ts renders with; 26 nodes at the
// default page size of 25 paginate to two pages so the footer fully renders.
const nodes = Array.from({ length: 26 }, (_, i) => ({
  id: `n${i}`,
  memoryId: 'm1',
  memory: { id: 'm1', urn: 'micromentor.org::mmdata', name: 'mmdata' },
  nodeType: 'info',
  loc: `node-${i}`,
  name: `Node ${i}`,
  description: null,
  tags: [],
})) as never;

function mountFooter() {
  const m = mountComponent(NodeList as never, {
    nodes,
    memoryUrn: 'micromentor.org::mmdata',
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  const footer = m.target.querySelector('[data-testid="table-footer"]') as HTMLElement;
  const select = footer.querySelector('select')!;
  const group = select.parentElement!;
  return { footer, group, select };
}

describe('NodeList footer containment (#1270)', () => {
  it('renders the pagination shape that overflowed: page indicator, select, Previous and Next', () => {
    const { footer, select } = mountFooter();
    expect(select.getAttribute('aria-label')).toBeTruthy();
    expect(footer.textContent).toMatch(/Page 1 of/);
    const buttons = [...footer.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toContain('Previous');
    expect(buttons).toContain('Next');
  });

  it('wraps the pagination row and the controls group like the shared DataTable footer', () => {
    const { footer, group } = mountFooter();
    // flex-wrap is what turns the phone-width overflow into a second line;
    // it must stay in lockstep with DataTable's footer, not drift back apart.
    expect(footer.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(group.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
  });

  it('a server-owned window renders every supplied row and no second pager', () => {
    const m = mountComponent(NodeList as never, {
      nodes: (nodes as unknown as Array<unknown>).slice(0, 20), serverPaged: true,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(m.target.querySelector('[data-testid="table-footer"]')).toBeNull();
    expect(m.target.textContent).not.toContain('Nodes per page');
  });
});
