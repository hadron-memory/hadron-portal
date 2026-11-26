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
  return [...section.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td .font-mono')?.textContent?.trim() ?? '');
}

describe('portal#2642 skipped-defaults search', () => {
  it('starts with both rows and restores them when cleared', () => {
    const m = mount();
    expect(shown(m.target, '')).toEqual(['alpha', 'beta']);
    expect(shown(m.target, 'alpha')).toEqual(['alpha']);
    expect(shown(m.target, '')).toEqual(['alpha', 'beta']);
  });
  it('does not search the raw field key, which no cell shows', () => {
    expect(shown(mount().target, 'authorTask')).toEqual([]);
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
  it('finds a reason a row gives for itself, as sent', () => {
    const m = mount();
    expect(shown(m.target, 'CUSTOM_REASON_X')).toEqual(['beta']);
    expect(shown(m.target, 'Why: CUSTOM')).toEqual(['beta']);
  });
  it('does not search the known reason: it is stated once above the table, not on a row', () => {
    const m = mount();
    expect(shown(m.target, 'available to the organization')).toEqual([]);
    expect(shown(m.target, 'REFERENCE_UNAVAILABLE')).toEqual([]);
  });
  it('matches nothing for text no row displays', () => {
    expect(shown(mount().target, 'zzz-not-there')).toEqual([]);
  });
});

// portal#2643: four columns, so the table fits a 1006px scroller (scripts/test-memory-config-layout.mjs).
describe('portal#2643 skipped-defaults columns', () => {
  const section = (root: HTMLElement) => root.querySelector('section[aria-labelledby="default-skips-heading"]')!;
  const NOTE = 'Unless a row gives its own reason, these rules were skipped because their task or node wasn’t available to the organization.';
  it('has role, template, reference and action columns only', () => {
    const heads = [...section(mount().target).querySelectorAll('thead th')].map(th => th.textContent?.replace(/[⇅↑↓▲▼]/g, '').trim());
    expect(heads).toEqual(['Role / sub-role', 'Template', 'Now', 'Actions']);
  });
  it('shows the field label under the role, not in a column of its own', () => {
    const cells = [...section(mount().target).querySelectorAll('tbody tr')].map(tr => [...tr.querySelector('td')!.querySelectorAll('span')].map(x => x.textContent!.trim()).join(' '));
    expect(cells).toEqual(['alpha Author task', 'beta Validation task']);
  });
  it('states the known reason once above the table, not on each row', () => {
    const root = mount().target;
    expect(section(root).textContent!.split(NOTE).length - 1).toBe(1);
    expect(section(root).querySelector('tbody')!.textContent).not.toContain('available to the organization');
  });
  it('gives a row its own reason only for a code the page does not know', () => {
    const rows = [...section(mount().target).querySelectorAll('tbody tr')].map(tr => tr.textContent!);
    expect(rows[0]).not.toContain('Why:');
    expect(rows[1]).toContain('Why: CUSTOM_REASON_X');
  });
  it('states no note when every reason is the page’s own to word', () => {
    const book: Rulebook = { id: 'c', rules: [], defaultSkips: [beta] };
    const m = mountComponent(RulebookManager, { initial: book, readOnly: false, memoryRef: 'm', memories: [], memoriesFailed: false });
    cleanup.push(m.unmount);
    expect(section(m.target).textContent).not.toContain('Unless a row gives its own reason');
  });
});
