import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import RulebookManager from './RulebookManager.svelte';
import type { DefaultSkip, Rulebook } from '$lib/memory-config/types';

// portal#2642: the skipped-defaults search matches what a row displays, not only
// its role and the raw field key. Each value below is unique to one row, so a
// match proves that value is searchable and a miss proves nothing else leaks in.
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.restoreAllMocks(); });

const alpha: DefaultSkip = { role: 'alpha', field: 'authorTask', reason: 'REFERENCE_UNAVAILABLE', ref: 'hrn:node:acme.com:kb:tasks:uniq-ref', refState: 'OK', sourceTemplate: { id: 't1', name: 'tmpl-one', deleted: false }, createdAt: '2026-11-01T00:00:00Z' };
const beta: DefaultSkip = { role: 'beta', field: 'validationTask', reason: 'CUSTOM_REASON_X', ref: null, refState: 'BROKEN', sourceTemplate: null, createdAt: '2026-11-01T00:00:00Z' };

function mount() {
  const book: Rulebook = { id: 'c', rules: [], defaultSkips: [alpha, beta] };
  const m = mountComponent(RulebookManager, { initial: book, readOnly: false, memoryRef: 'm', memories: [], memoriesFailed: false });
  cleanup.push(m.unmount);
  return m;
}
function shown(root: HTMLElement, value: string): string[] {
  const input = root.querySelector<HTMLInputElement>('input[aria-label="Search skipped rules…"]')!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  const section = root.querySelector('section[aria-labelledby="default-skips-heading"]')!;
  return [...section.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td')?.textContent?.trim() ?? '');
}

describe('portal#2642 skipped-defaults search', () => {
  it('starts with both rows and restores them when cleared', () => {
    const m = mount();
    expect(shown(m.target, '')).toEqual(['alpha', 'beta']);
    expect(shown(m.target, 'alpha')).toEqual(['alpha']);
    expect(shown(m.target, '')).toEqual(['alpha', 'beta']);
  });
  it('still finds the raw field key', () => {
    expect(shown(mount().target, 'authorTask')).toEqual(['alpha']);
  });
  it('finds the field label a row displays', () => {
    const m = mount();
    expect(shown(m.target, 'Validation task')).toEqual(['beta']);
    expect(shown(m.target, 'Author task')).toEqual(['alpha']);
  });
  it('finds the template name, and "template deleted" for a row with none', () => {
    const m = mount();
    expect(shown(m.target, 'tmpl-one')).toEqual(['alpha']);
    expect(shown(m.target, 'template deleted')).toEqual(['beta']);
  });
  it('finds the reference address when it is readable', () => {
    expect(shown(mount().target, 'uniq-ref')).toEqual(['alpha']);
  });
  it('finds the reference state copy when there is no address', () => {
    const m = mount();
    expect(shown(m.target, 'BROKEN')).toEqual(['beta']);
    expect(shown(m.target, 'referenced node is unavailable')).toEqual(['beta']);
  });
  it('finds the reason in the words shown, and an unknown code as sent', () => {
    const m = mount();
    expect(shown(m.target, 'available to the organization')).toEqual(['alpha']);
    expect(shown(m.target, 'REFERENCE_UNAVAILABLE')).toEqual([]);
    expect(shown(m.target, 'CUSTOM_REASON_X')).toEqual(['beta']);
  });
  it('matches nothing for text no row displays', () => {
    expect(shown(mount().target, 'zzz-not-there')).toEqual([]);
  });
});
