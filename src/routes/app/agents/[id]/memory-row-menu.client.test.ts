/**
 * #1020 (Cody's #1047 QA): an agent's memory rows keep Remove in a ⋯ menu that
 * submits one hidden form. Remove has NO confirm (as before the menu), so the
 * hidden form carrying the PICKED memory is the only guard — pin it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { rowMenuItems } from '$lib/test/rowMenu';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

const item = (id: string, name: string) => ({
  role: 'read', memory: { id, name, urn: `hrn:mem:ada:${id}`, class: 'PRIVATE', vectorIndexEnabled: false },
});

describe('agent Memories — Remove in the row ⋯ menu (#1020)', () => {
  it('submits the hidden remove form for the PICKED memory, uncancelled', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const m = mountComponent(Page as never, {
      data: await pageData('a', { mentionOnly: false }, { memoryItems: [item('mem-1', 'Alpha'), item('mem-2', 'Bravo')] }),
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Memories')!.click();
    await tick(2);

    const removes = rowMenuItems(m.target, 'Remove');
    expect(removes).toHaveLength(2);
    removes[1]!.click();
    await tick(2);

    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/removeMemory');
    expect(form.querySelector<HTMLInputElement>('input[name="memoryId"]')!.value).toBe('mem-2');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });
});
