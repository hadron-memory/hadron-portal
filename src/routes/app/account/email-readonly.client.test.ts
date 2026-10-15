/** The profile form cannot change the email address (hadron-server#1801 refuses a changed value). */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const user = { id: 'u1', name: 'Ada', handle: 'ada', email: 'ada@example.com', githubUsername: null, avatarUrl: null };
const profileForm = {
  id: 'f1', valid: true, posted: false, errors: {}, constraints: {},
  data: { name: 'Ada', handle: 'ada', email: 'ada@example.com' },
};

function openEditor(over: Record<string, unknown> = {}) {
  const m = mountComponent(Page as never, { data: { user, form: { ...profileForm, ...over } }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  const edit = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit');
  edit!.click();
  flushSync();
  return m.target;
}

describe('Account profile form — email', () => {
  it('shows the current address read-only with a line that changing it is not supported', () => {
    const t = openEditor();
    const email = t.querySelector<HTMLInputElement>('#editEmail')!;
    expect(email.value).toBe('ada@example.com');
    expect(email.readOnly).toBe(true);
    expect(email.getAttribute('aria-describedby')).toBe('editEmailHelp');
    expect(t.querySelector('#editEmailHelp')?.textContent).toContain('Changing your email address is not supported here.');
  });

  it('leaves name and handle editable', () => {
    const t = openEditor();
    expect(t.querySelector<HTMLInputElement>('#editName')!.readOnly).toBe(false);
    expect(t.querySelector<HTMLInputElement>('#editHandle')!.readOnly).toBe(false);
  });

  it('shows the field error on the field only, not again in the banner (#1080, item 1)', () => {
    const t = openEditor({ errors: { email: ['Changing your email address is not supported here.'] } });
    const hits = [...t.querySelectorAll('p, div')].filter(
      (el) => el.children.length === 0 && el.textContent?.includes('not supported here'),
    );
    expect(hits.map((el) => el.id)).toEqual(['editEmailError']);
  });

  it("shows the server's own words under the fixed copy (#1080, item 3)", () => {
    const t = openEditor({
      errors: { email: ['Changing your email address is not supported here.', 'The server said: email is not a valid address'] },
    });
    expect(t.querySelector('#editEmailError')?.textContent).toContain('not supported here');
    expect(t.querySelector('#editEmailError')?.textContent).toContain('The server said: email is not a valid address');
  });

  it('gives the help line a dark-mode colour (#1080, item 4)', () => {
    const t = openEditor();
    expect(t.querySelector('#editEmailHelp')!.className).toMatch(/\bdark:text-zinc-400\b/);
  });

  it('shows a refusal that arrives anyway as a field error, in place of the help line', () => {
    const t = openEditor({ errors: { email: ['Changing your email address is not supported here.'] } });
    expect(t.querySelector('#editEmailError')?.textContent).toContain('not supported here');
    expect(t.querySelector('#editEmail')!.getAttribute('aria-invalid')).toBe('true');
    expect(t.querySelector('#editEmailHelp')).toBeNull();
  });
});
