/** #1061: the URN suggested from an organization name is accepted by the validator. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { validateOrgSlugField } from '$lib/urn/form-validation';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const emptyForm = {
  id: 'f1', valid: false, posted: false, errors: {}, constraints: {},
  data: { name: '', urn: '' },
};

function mountPage(over: { prefillUrn?: string } = {}) {
  const m = mountComponent(Page as never, {
    data: { prefillUrn: over.prefillUrn ?? '', form: emptyForm },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

function typeName(t: HTMLElement, value: string) {
  const name = t.querySelector<HTMLInputElement>('#name')!;
  name.value = value;
  name.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('New organization — URN suggestion', () => {
  it('derives an undotted URN from the name, and the validator accepts it', () => {
    const t = mountPage();
    typeName(t, 'Mini Coders Den');
    const urn = t.querySelector<HTMLInputElement>('#urn')!.value;
    expect(urn).toBe('mini-coders-den');
    expect(validateOrgSlugField(urn)).toBeNull();
  });

  it('does not overwrite a URN the user has typed', () => {
    const t = mountPage();
    const urn = t.querySelector<HTMLInputElement>('#urn')!;
    urn.value = 'mine';
    urn.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    typeName(t, 'Mini Coders Den');
    expect(urn.value).toBe('mine');
  });

  it('never words the URN help in terms of a verified domain', () => {
    const t = mountPage();
    expect(t.querySelector('#urnHelp')?.textContent ?? '').not.toMatch(/verified|domain/i);
  });
});
