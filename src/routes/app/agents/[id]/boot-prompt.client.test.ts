import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });
async function open() {
  const data = await pageData('a', { mentionOnly: false }, { systemPrompt: '# Boot instructions\n\n  Keep {{worker.name}}.\n' });
  mounted = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  return mounted.target;
}
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;

describe('#999 boot prompt tab', () => {
  it('moves the prompt out of Profile into its own Rendered/Source tab', async () => {
    const root = await open();
    expect(root.querySelector('[data-boot-prompt]')?.closest('[hidden]')).not.toBeNull();
    expect([...root.querySelectorAll('h1, p')].filter((el) => !el.closest('[hidden]')).map((el) => el.textContent).join(' ')).not.toContain('Boot instructions');
    expect(button(root, 'Boot prompt')).toBeDefined();
    button(root, 'Boot prompt').click();
    for (let i = 0; i < 4; i++) await tick();
    expect(root.querySelector('[data-boot-prompt] h1')?.textContent).toBe('Boot instructions');
    button(root, 'Source').click();
    await tick();
    expect(root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')?.value).toBe('# Boot instructions\n\n  Keep {{worker.name}}.\n');
  });

  it('keeps an unsaved source draft when switching tabs', async () => {
    const root = await open();
    button(root, 'Boot prompt').click();
    await tick();
    button(root, 'Source').click();
    await tick();
    const textarea = root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')!;
    textarea.value = 'unsaved';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    button(root, 'Profile').click();
    await tick();
    button(root, 'Boot prompt').click();
    await tick();
    expect(root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')?.value).toBe('unsaved');
  });
});
