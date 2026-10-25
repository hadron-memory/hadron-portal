/**
 * portal#1299 — Decline's own confirmation: it says what declining does for an
 * approved and for an unapproved automation, and only the confirmation sends it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const summary = { name: 'Nightly digest', schedule: 'Runs daily.', reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] };
const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
function open(state: string) {
  const m = mountComponent(Page as never, { data: { app, kind: 'SCHEDULE', ref: 'sch-1', approval: { state, hash: 'h1', depth: {}, summary } }, form: null });
  mounted.push(m as never);
  return m.target as HTMLElement;
}
const button = (t: HTMLElement, label: string) => [...t.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const declineForm = (t: HTMLElement) => t.querySelector<HTMLFormElement>('form[action="?/decline"]');

describe('Decline confirmation', () => {
  it('Decline alone sends nothing: it opens a confirmation first', () => {
    const t = open('UNADOPTED');
    expect(declineForm(t)).toBeNull();
    button(t, 'Decline')!.click(); flushSync();
    expect(declineForm(t)).not.toBeNull();
  });

  it('on an approved automation says its next run will fail until it is approved again', () => {
    const t = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(t.textContent).toContain('Its next run will fail until it is approved again.');
  });

  it('on an unapproved automation says it only records the decline', () => {
    const t = open('UNADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(t.textContent).toContain('This only records that you declined.');
    expect(t.textContent).not.toContain('next run will fail');
  });

  it('the decline form carries no hash and can be cancelled', () => {
    const t = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(declineForm(t)!.querySelector('input[name="expectedHash"]')).toBeNull();
    button(t, 'Cancel')!.click(); flushSync();
    expect(declineForm(t)).toBeNull();
  });
});
