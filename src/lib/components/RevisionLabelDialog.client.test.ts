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

  // D3 (portal#2457): the cap is the server's, so the field carries no number.
  it('carries no length cap of its own', () => {
    const m = mountDialog({ label: null, busy: false, error: null, onsave: () => {}, oncancel: () => {} });
    expect(input(m).hasAttribute('maxlength')).toBe(false);
  });

  // D1: one busy-dismissal behaviour: nothing dismisses a save in flight.
  const backdrop = (m: Mounted<Record<string, unknown>>) => m.target.querySelector<HTMLButtonElement>('button[tabindex="-1"]')!;
  const escape = (m: Mounted<Record<string, unknown>>) =>
    m.target.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  it('while busy, the backdrop, Cancel and Escape all leave the dialog open', () => {
    const oncancel = vi.fn();
    const m = mountDialog({ label: 'x', busy: true, error: null, onsave: () => {}, oncancel });
    backdrop(m).click();
    m.target.querySelector<HTMLButtonElement>('[data-testid="revision-label-cancel"]')!.click();
    escape(m);
    expect(m.target.querySelector<HTMLButtonElement>('[data-testid="revision-label-cancel"]')!.disabled).toBe(true);
    expect(oncancel).not.toHaveBeenCalled();
  });

  it('when idle, the backdrop, Cancel and Escape each dismiss', () => {
    const oncancel = vi.fn();
    const m = mountDialog({ label: 'x', busy: false, error: null, onsave: () => {}, oncancel });
    backdrop(m).click();
    expect(oncancel).toHaveBeenCalledTimes(1);
    click(m, 'revision-label-cancel');
    expect(oncancel).toHaveBeenCalledTimes(2);
    escape(m);
    expect(oncancel).toHaveBeenCalledTimes(3);
  });

  // D2: a refusal is announced, and the field points at it.
  it('announces a refusal as an alert the field is described by', () => {
    const m = mountDialog({ label: 'x', busy: false, error: 'revLabel exceeds the 500-character cap.', onsave: () => {}, oncancel: () => {} });
    const alert = m.target.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('revLabel exceeds the 500-character cap.');
    expect(input(m).getAttribute('aria-describedby')).toBe('revision-label-help revision-label-error');
    expect(m.target.querySelector('#revision-label-error')).toBe(alert);
  });

  it('has no alert and points only at its help text when there is no refusal', () => {
    const m = mountDialog({ label: 'x', busy: false, error: null, onsave: () => {}, oncancel: () => {} });
    expect(m.target.querySelector('[role="alert"]')).toBeNull();
    expect(input(m).getAttribute('aria-describedby')).toBe('revision-label-help');
  });
});
