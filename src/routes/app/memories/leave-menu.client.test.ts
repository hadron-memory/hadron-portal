/**
 * #1020: "Leave" moved from a per-row form into the row's ⋯ menu, submitting a
 * single hidden form. What must hold: the form carries the PICKED row's id,
 * declining the confirm submits nothing, and the enhanced submit tells the
 * server the browser already confirmed (so it skips its no-JS step).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

const shared = (id: string, name: string) => ({
  id, name, urn: `hrn:mem:acme.com:${id}`, class: 'PRIVATE',
  myShare: { role: 'reader', grantor: { id: 'u9', name: 'Grace', handle: 'grace', email: null } },
});

async function openLeave(row: number) {
  setStubPage('https://example.test/app/memories', {});
  const m = mountComponent(Page as never, {
    data: { memories: [], sharedMemories: [shared('m1', 'Alpha'), shared('m2', 'Bravo')] },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  [...m.target.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => /shared/i.test(t.textContent ?? ''))!.click();
  flushSync();
  m.target.querySelectorAll<HTMLButtonElement>('button[aria-label^="Actions for"]')[row]!.click();
  flushSync();
  const leave = [...m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Leave')!;
  return { target: m.target, leave };
}

describe('Memories shared with me — Leave in the ⋯ menu (#1020)', () => {
  it('submits the hidden form for the PICKED row, marked as already confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const { target, leave } = await openLeave(1);
    leave.click();
    await tick(2);

    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/leaveShare');
    expect(form.querySelector<HTMLInputElement>('input[name="memoryId"]')!.value).toBe('m2');
    expect(target.contains(form)).toBe(true);
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('submits nothing when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const { leave } = await openLeave(0);
    leave.click();
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});
