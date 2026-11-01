/**
 * portal#1142 S8 — the pointer component, mounted (hadron-server#2219; Xylon's
 * stamp 6330444824): four read states, the served line on every one, the
 * form hidden only on an explicit `canManage: false`, a refusal shown escaped
 * with the draft kept, and a fresh read replacing the old one after a save.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import BootPromptPointer from './BootPromptPointer.svelte';

const URN = 'hrn:node:acme.com:team-sys:boot:compiled';
// portal#1399: what is served today (hrn:node:hadronmemory.com:specs:cor:agt:040:07, :10).
const SERVED = 'Agents start with the newest approved revision of the compiled prompt named by the highest set pointer: the worker’s, else the App’s, else the Agent’s.';
const OLD_NOT_SERVED = /not used to start agents yet/i;
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountPointer(props: Record<string, unknown>) {
  const p = reactiveProps<Record<string, unknown>>({ canManage: true, action: '?/setBootPrompt', idPrefix: 'p', ...props });
  const m = mountComponent(BootPromptPointer as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p };
}

describe('BootPromptPointer', () => {
  it('a set pointer is a URN chip, with the served line', async () => {
    const { root } = await mountPointer({ read: { ok: true, ref: URN, deleted: false } });
    expect(root.querySelector(`[title="${URN}"]`)).not.toBeNull();
    expect(root.textContent).toContain(SERVED);
    expect(root.textContent).not.toContain('deleted');
  });

  it('the retired "not used to start agents yet" sentence is gone (#1399)', async () => {
    for (const read of [{ ok: true, ref: URN, deleted: false }, { ok: true, ref: URN, deleted: true }, { ok: true, ref: null, deleted: null }, { ok: false }]) {
      const { root } = await mountPointer({ read });
      expect(root.textContent).not.toMatch(OLD_NOT_SERVED);
      expect(root.textContent).toContain(SERVED);
    }
  });

  // A deleted target is refused at boot (TARGET_DELETED), never fallen through,
  // so the only serving copy on the card is the general rule, which names no
  // particular target ("this names" would point at the deleted one).
  it('a deleted target says to clear or repoint, and the served line is only the general rule', async () => {
    const { root } = await mountPointer({ read: { ok: true, ref: URN, deleted: true } });
    expect(root.querySelector('[data-pointer-state="deleted"]')?.textContent).toBe('The target was deleted; clear or repoint it.');
    const servingCopy = [...root.querySelectorAll('p')].map((p) => p.textContent ?? '').filter((s) => /\bstart|serv/i.test(s));
    expect(servingCopy).toEqual([SERVED]);
    expect(SERVED).not.toMatch(/\bthis\b/);
  });

  it('a null pair is "Not shown", never "no pointer", and has no chip', async () => {
    const { root } = await mountPointer({ read: { ok: true, ref: null, deleted: null } });
    expect(root.querySelector('[data-pointer-state="not-shown"]')?.textContent).toBe('Not shown');
    expect(root.textContent).not.toMatch(/no pointer|not set/i);
    expect(root.querySelector('code [title]')).toBeNull();
  });

  it('a failed read says so, apart from a masked one', async () => {
    const { root } = await mountPointer({ read: { ok: false } });
    expect(root.querySelector('[data-pointer-state="unavailable"]')).not.toBeNull();
    expect(root.querySelector('[data-pointer-state="not-shown"]')).toBeNull();
  });

  it('the form shows on canManage true or null, and hides only on an explicit false; the read stays', async () => {
    for (const [canManage, shown] of [[true, true], [null, true], [false, false]] as const) {
      const { root } = await mountPointer({ read: { ok: true, ref: URN, deleted: false }, canManage });
      expect(!!root.querySelector('form')).toBe(shown);
      expect(root.querySelector(`[title="${URN}"]`)).not.toBeNull();
      expect(root.textContent).toContain(SERVED);
    }
  });

  it('Set and Clear are two submits with an explicit intent', async () => {
    const { root } = await mountPointer({ read: { ok: true, ref: null, deleted: null } });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].map((b) => [b.name, b.value]);
    expect(buttons).toEqual([['intent', 'set'], ['intent', 'clear']]);
    expect(root.querySelector('form')?.getAttribute('action')).toBe('?/setBootPrompt');
  });

  it('a refusal keeps the typed ref and shows the lead, the server message escaped and the code', async () => {
    const message = 'Node <img src=x onerror=alert(1)> refused.';
    const { root } = await mountPointer({
      read: { ok: true, ref: null, deleted: null },
      result: { key: 'k', nodeRef: 'my-typed-ref', refusal: { code: 'BOOT_PROMPT_POINTER_NOT_COMPILED', lead: 'That node isn’t a compiled boot prompt.', message } },
    });
    expect(root.querySelector<HTMLInputElement>('input[name="nodeRef"]')?.value).toBe('my-typed-ref');
    const alert = root.querySelector('[data-testid="boot-pointer-refusal"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('That node isn’t a compiled boot prompt.');
    expect(alert?.textContent).toContain(message);
    expect(alert?.textContent).toContain('BOOT_PROMPT_POINTER_NOT_COMPILED');
    expect(alert?.querySelector('img')).toBeNull();
  });

  // Gaia's P2-2 on #1246: the enhanced submit itself hands the result to kit's
  // update(), which re-runs the loader and applies the action; without it a
  // Set neither refreshes the read nor shows its result.
  it('an enhanced submit calls kit’s update without resetting the field, then re-enables the buttons', async () => {
    const { root } = await mountPointer({ read: { ok: true, ref: null, deleted: null } });
    const update = vi.fn(async () => {});
    await submitEnhancedWithResult(root.querySelector('form')!, { type: 'success', status: 200, data: { pointer: { key: 'k', ok: true, cleared: false } } }, { update });
    await tick(2);
    flushSync();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ reset: false });
    expect([...root.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].every((b) => !b.disabled)).toBe(true);
  });

  it('after a save the fresh read replaces the old one (stale loader refresh)', async () => {
    const { root, props } = await mountPointer({ read: { ok: true, ref: null, deleted: null } });
    props.read = { ok: true, ref: URN, deleted: false };
    props.result = { key: 'k', ok: true, cleared: false };
    await tick(2);
    flushSync();
    expect(root.querySelector(`[title="${URN}"]`)).not.toBeNull();
    expect(root.querySelector('[data-pointer-state="not-shown"]')).toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent?.trim()).toBe('Pointer set.');
  });
});
