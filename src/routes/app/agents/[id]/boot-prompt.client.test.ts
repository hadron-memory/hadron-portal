import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });
async function open(canManageAgent = true) {
  const data = await pageData('a', { mentionOnly: false }, { systemPrompt: '# Boot instructions\n\n  Keep {{worker.name}}.\n' });
  mounted = mountComponent(Page as never, { data: { ...data, canManageAgent }, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  return mounted.target;
}
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;

describe('#999 boot prompt tab', () => {
  it('keeps a reader source read-only and offers no save', async () => {
    const root = await open(false);
    button(root, 'Boot prompt').click();
    button(root, 'Source').click();
    await tick();
    expect(root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')?.readOnly).toBe(true);
    expect(root.querySelector('[data-boot-prompt] button[type=submit]')).toBeNull();
  });

  it('cancel restores the stored source without a request', async () => {
    const root = await open();
    button(root, 'Boot prompt').click();
    button(root, 'Source').click();
    await tick();
    const textarea = root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')!;
    textarea.value = 'discard me';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    button(root, 'Cancel').click();
    await tick();
    expect(textarea.value).toBe('# Boot instructions\n\n  Keep {{worker.name}}.\n');
  });

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

it('renders raw placeholders through the sanitizer without executable markup', async () => {
  const data = await pageData('unsafe', null, { systemPrompt: '# {{name}}\n<script>window.bad=true</script><img src=x onerror="window.bad=true"><a href="javascript:alert(1)">bad</a>' });
  mounted = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  const preview = mounted.target.querySelector('[data-boot-prompt] .prose')!;
  expect(preview.querySelector('h1')?.textContent).toBe('{{name}}');
  expect(preview.querySelector('script, [onerror], a[href^="javascript:"]')).toBeNull();
});

it('reseeds the editor when navigating from one agent to another', async () => {
  const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
  const props = reactiveProps({ data: await pageData('a', null, { systemPrompt: 'Agent A' }), form: null } as Record<string, unknown>);
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  const root = mounted.target;
  button(root, 'Boot prompt').click();
  button(root, 'Source').click();
  await tick();
  const input = root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')!;
  input.value = 'draft A'; input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  props.data = await pageData('b', null, { systemPrompt: 'Agent B' });
  await tick(5);
  expect(root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')?.value).toBe('Agent B');
});

it('isolates a delayed old agent save from the new editor and feedback', async () => {
  const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
  const { submitEnhancedDeferred } = await import('$lib/test/stubs/app-forms');
  const { setStubPage, resetStubPage } = await import('$lib/test/stubs/app-stores');
  setStubPage('http://localhost/app/agents/a');
  try {
    const a = await pageData('a', null, { systemPrompt: 'Agent A' });
    const props = reactiveProps({ data: a, form: null } as Record<string, unknown>);
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await tick(5);
    const root = mounted.target;
    button(root, 'Boot prompt').click(); button(root, 'Source').click();
    await tick();
    const textarea = root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')!;
    textarea.value = 'Late A'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const pending = await submitEnhancedDeferred(root.querySelector<HTMLFormElement>('[data-boot-prompt] form')!);
    props.data = await pageData('b', null, { systemPrompt: 'Agent B' });
    setStubPage('http://localhost/app/agents/b');
    await tick(5);
    const result = { type: 'success' as const, status: 200, data: { form: {
      ...a.bootPromptForm, posted: true, valid: true,
      data: { _kind: 'bootPrompt', systemPrompt: 'Late A' },
      message: { type: 'success', text: 'Boot prompt saved.' },
    } } };
    await pending.finish(result);
    // Kit also exposes the same action data as the page's form prop.
    props.form = result.data;
    await tick(5);
    expect(root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')?.value).toBe('Agent B');
    expect(root.querySelector('[data-boot-prompt] [role=status]')).toBeNull();
  } finally { resetStubPage(); }
});

it('still applies a save result to the agent that submitted it', async () => {
  const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
  const { submitEnhancedWithResult } = await import('$lib/test/stubs/app-forms');
  const { setStubPage, resetStubPage } = await import('$lib/test/stubs/app-stores');
  setStubPage('http://localhost/app/agents/a');
  try {
    const data = await pageData('a', null, { systemPrompt: 'Agent A' });
    const props = reactiveProps({ data, form: null } as Record<string, unknown>);
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await tick(5);
    const root = mounted.target;
    button(root, 'Boot prompt').click(); button(root, 'Source').click();
    await tick();
    const result = { type: 'success' as const, status: 200, data: { form: {
      ...data.bootPromptForm, posted: true, valid: true,
      data: { _kind: 'bootPrompt', systemPrompt: 'Saved A' },
      message: { type: 'success', text: 'Boot prompt saved.' },
    } } };
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('[data-boot-prompt] form')!, result);
    props.form = result.data;
    await tick(5);
    expect(root.querySelector<HTMLTextAreaElement>('[data-boot-prompt] textarea')?.value).toBe('Saved A');
    expect(root.querySelector('[data-boot-prompt] [role=status]')?.textContent).toBe('Boot prompt saved.');
  } finally { resetStubPage(); }
});
