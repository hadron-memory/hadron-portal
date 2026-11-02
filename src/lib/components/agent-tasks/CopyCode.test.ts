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
    // review:visible-label-is-the-accessible-name — an aria-label must not
    // disagree with visible copy: it has to contain the visible button text.
    const html = out({ value: 'AT3.405', label: 'Copy the task handle', name: 'Handle' });
    expect(html).toMatch(/<button[^>]*aria-label="Copy the task handle"[^>]*>Copy<\/button>/);
  });

  it('renders no name span when no name is given (other call sites unchanged)', () => {
    const html = out({ value: 'hadron team alarm ack a1', label: 'Copy the command that acknowledges this alarm' });
    expect(html).not.toContain('data-copy-name');
    expect(html).toMatch(/<code[^>]*>hadron team alarm ack a1<\/code>/);
  });
});
