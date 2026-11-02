/**
 * portal#1415 item 2 — the detail page stacks three CopyCode rows (handle, id,
 * CLI) that differ only by their aria-labels: a sighted reader sees three
 * "Copy" buttons with no visible name. A `name` renders as a short visible
 * label beside the value.
 *
 * SSR (`render` from `svelte/server`): markup, no lifecycle — the `node` lane,
 * per the repo's two-lane rule. The clipboard itself is browser behavior and
 * is not testable here; what is testable is that the visible name is content.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import CopyCode from './CopyCode.svelte';

const out = (props: { value: string; label: string; name?: string }) => render(CopyCode, { props }).body;

describe('CopyCode', () => {
  it('renders a short visible name beside the value when one is given', () => {
    const html = out({ value: 'AT3.405', label: 'Copy the task handle', name: 'Handle' });
    expect(html).toMatch(/<span[^>]*data-copy-name[^>]*>\s*Handle\s*<\/span>/);
    // The value and the verb stay as they were.
    expect(html).toMatch(/<code[^>]*>AT3\.405<\/code>/);
    expect(html).toContain('>Copy</button>');
  });

  it('keeps the button name agreeing with its visible text (Label in Name)', () => {
    // hrn:node:hadronmemory.com:hadron-portal:review:visible-label-is-the-accessible-name —
    // an aria-label must not disagree with visible copy: it has to contain the
    // visible button text.
    const html = out({ value: 'AT3.405', label: 'Copy the task handle', name: 'Handle' });
    expect(html).toMatch(/<button[^>]*aria-label="Copy the task handle"[^>]*>Copy<\/button>/);
  });

  it('renders no name span when no name is given (other call sites unchanged)', () => {
    const html = out({ value: 'hadron team alarm ack a1', label: 'Copy the command that acknowledges this alarm' });
    expect(html).not.toContain('data-copy-name');
    expect(html).toMatch(/<code[^>]*>hadron team alarm ack a1<\/code>/);
  });

  // portal#1635 item 2: the Copy button is a text-sized target. WCAG 2.2 AA 2.5.8 wants
  // at least 24x24 CSS px; min-h-6/min-w-6 (1.5rem) reaches it without changing the text size.
  it('gives the Copy button a 24x24 minimum hit area, centred, text size unchanged', () => {
    const html = out({ value: 'AT3.405', label: 'Copy the task handle' });
    const cls = html.match(/<button[^>]*class="([^"]*)"/)?.[1] ?? '';
    const has = (c: string) => cls.split(/\s+/).includes(c);
    expect(has('min-h-6')).toBe(true);
    expect(has('min-w-6')).toBe(true);
    expect(has('inline-flex')).toBe(true);
    expect(has('items-center')).toBe(true);
    expect(has('justify-center')).toBe(true);
    expect(has('text-xs')).toBe(true);
  });
});
