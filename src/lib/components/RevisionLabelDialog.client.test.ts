/** #534 — the "Edit label" popup on a node revision. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import RevisionLabelDialog from './RevisionLabelDialog.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});
function mountDialog(props: Record<string, unknown>) {
  const m = mountComponent(RevisionLabelDialog as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}
const input = (m: Mounted<Record<string, unknown>>) =>
  m.target.querySelector<HTMLInputElement>('[data-testid="revision-label-input"]')!;
const click = (m: Mounted<Record<string, unknown>>, id: string) =>
  m.target.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click();

describe('RevisionLabelDialog (#534)', () => {
  it('opens on the revision’s current label', () => {
    const m = mountDialog({ label: 'before rewrite', busy: false, error: null, onsave: () => {}, oncancel: () => {} });
    expect(input(m).value).toBe('before rewrite');
  });

  it('opens empty when the revision has no label', () => {
    const m = mountDialog({ label: null, busy: false, error: null, onsave: () => {}, oncancel: () => {} });
    expect(input(m).value).toBe('');
  });

  it('saves what was typed', () => {
    const onsave = vi.fn();
    const m = mountDialog({ label: null, busy: false, error: null, onsave, oncancel: () => {} });
    input(m).value = 'v2 release';
    input(m).dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    click(m, 'revision-label-save');
    expect(onsave).toHaveBeenCalledWith('v2 release');
  });

  it('cancels without saving', () => {
    const onsave = vi.fn();
    const oncancel = vi.fn();
    const m = mountDialog({ label: 'x', busy: false, error: null, onsave, oncancel });
    click(m, 'revision-label-cancel');
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(onsave).not.toHaveBeenCalled();
  });

  it('disables Save while busy and shows the server error', () => {
    const m = mountDialog({ label: 'x', busy: true, error: 'Revision action failed', onsave: () => {}, oncancel: () => {} });
    expect(m.target.querySelector<HTMLButtonElement>('[data-testid="revision-label-save"]')!.disabled).toBe(true);
    expect(m.target.textContent).toContain('Revision action failed');
  });

  it('caps the input at the server’s 500 characters', () => {
    const m = mountDialog({ label: null, busy: false, error: null, onsave: () => {}, oncancel: () => {} });
    expect(input(m).maxLength).toBe(500);
  });
});
