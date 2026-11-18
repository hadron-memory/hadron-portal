/** #1270 — the usage-events grid predates the shared DataTable extraction and
 * still carries its own copy of the pagination footer. That copy must wrap the
 * same way the shared one now does: the rows-per-page select is sized by its
 * longest option label and cannot shrink beside Previous/Next, so a no-wrap
 * footer pushes the document wide on a 390px phone.
 *
 * jsdom does not lay out, so this pins the wrap contract on the rendered
 * markup; the geometry evidence is the browser receipt in the PR.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import UsageEventsTable from './UsageEventsTable.svelte';
import type { UsageEvent } from './usageEvent';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const events: UsageEvent[] = Array.from({ length: 25 }, (_, i) => ({
  id: `e${i}`,
  type: 'node.get',
  nodeLoc: `example.com:mem:node-${i}`,
  appId: null,
  sessionId: null,
  model: 'claude-sonnet-5-5',
  tokensIn: 10,
  tokensOut: 20,
  createdAt: new Date(Date.UTC(2026, 9, 24, i % 24)).toISOString(),
}));

function mountFooter() {
  const m = mountComponent(UsageEventsTable as never, {
    events,
    listKey: 'test:usage-footer',
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  const footer = m.target.querySelector('[data-testid="table-footer"]') as HTMLElement;
  const select = footer.querySelector('select')!;
  const group = select.parentElement!;
  return { footer, group, select };
}

describe('UsageEventsTable footer containment (#1270)', () => {
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
});
