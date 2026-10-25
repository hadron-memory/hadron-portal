/**
 * portal#1299 — the approval page's client behaviour: Decline's own
 * confirmation (and that it belongs to ONE automation), where focus goes, and
 * what the enhanced submit does with the server's answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, tick } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const summary = (name = 'Nightly digest') => ({ name, schedule: 'Runs daily.', reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] });
const data = (state: string, ref = 'sch-1', name = 'Nightly digest', hash = 'h1') =>
  ({ app, kind: 'SCHEDULE', ref, approval: { state, hash, depth: {}, summary: summary(name) } });
const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => { resetNavigationCalls(); });
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
function open(state: string, form: unknown = null) {
  const props = reactiveProps<Record<string, unknown>>({ data: data(state), form });
  const m = mountComponent(Page as never, props);
  mounted.push(m as never);
  return { t: m.target as HTMLElement, props };
}
const button = (t: HTMLElement, label: string) => [...t.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const declineForm = (t: HTMLElement) => t.querySelector<HTMLFormElement>('form[action="?/decline"]');
const approveForm = (t: HTMLElement) => t.querySelector<HTMLFormElement>('form[action="?/approve"]');

describe('Decline confirmation', () => {
  it('Decline alone sends nothing: it opens a confirmation first', () => {
    const { t } = open('UNADOPTED');
    expect(declineForm(t)).toBeNull();
    button(t, 'Decline')!.click(); flushSync();
    expect(declineForm(t)).not.toBeNull();
  });

  it('on an approved automation says its next run will fail until it is approved again', () => {
    const { t } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(t.textContent).toContain('Its next run will fail until it is approved again.');
  });

  it('on an unapproved automation says it only records the decline', () => {
    const { t } = open('UNADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(t.textContent).toContain('This only records that you declined.');
    expect(t.textContent).not.toContain('next run will fail');
  });

  it('the decline form carries no hash and can be cancelled', () => {
    const { t } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(declineForm(t)!.querySelector('input[name="expectedHash"]')).toBeNull();
    button(t, 'Cancel')!.click(); flushSync();
    expect(declineForm(t)).toBeNull();
  });
});

describe('the confirmation belongs to one automation (LOCAL P2)', () => {
  it('navigating A to B closes A’s confirmation: the relative ?/decline would now address B', () => {
    const { t, props } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    expect(declineForm(t)).not.toBeNull();
    props.data = data('ADOPTED', 'sch-2', 'Weekly report', 'h2'); flushSync();
    expect(t.querySelector('h1')!.textContent).toBe('Weekly report');
    expect(declineForm(t)).toBeNull();
    expect(button(t, 'Decline')).toBeTruthy();
  });

  it('and coming back to A does not reopen it', () => {
    const { t, props } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    props.data = data('ADOPTED', 'sch-2', 'Weekly report', 'h2'); flushSync();
    props.data = data('ADOPTED'); flushSync();
    expect(t.querySelector('h1')!.textContent).toBe('Nightly digest');
    expect(declineForm(t)).toBeNull();
  });

  it('a reload of the SAME automation keeps the confirmation open', () => {
    const { t, props } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    props.data = data('ADOPTED', 'sch-1', 'Nightly digest', 'h-reloaded'); flushSync();
    expect(declineForm(t)).not.toBeNull();
  });
});

describe('focus (UX P2)', () => {
  it('opening the confirmation moves focus into it, and Cancel returns it to Decline', async () => {
    const { t } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync(); await tick();
    const confirm = t.querySelector<HTMLElement>('[data-testid="decline-confirmation"]')!;
    expect(confirm).toBeTruthy();
    expect(confirm.contains(document.activeElement)).toBe(true);
    button(t, 'Cancel')!.click(); flushSync(); await tick();
    expect(document.activeElement).toBe(button(t, 'Decline'));
  });

  it('after a submit the outcome is where focus goes, since the button that sent it is gone', async () => {
    const { t, props } = open('UNADOPTED');
    await submitEnhancedWithResult(approveForm(t)!, { type: 'success', status: 200, data: { approved: true } }, {
      update: async () => { props.data = data('ADOPTED'); props.form = { approved: true }; },
    });
    flushSync(); await tick();
    const notice = t.querySelector<HTMLElement>('[data-testid="automation-outcome"]')!;
    expect(notice.textContent).toContain('Approved.');
    expect(document.activeElement).toBe(notice);
  });
});

describe('malformed server data (BLIND P3)', () => {
  it('two flows that share a URN both render instead of throwing a duplicate-key error', () => {
    const flow = { name: 'Digest', urn: 'hrn:node:acme.com:team:flows:digest', tools: [], writes: [] };
    const d = data('UNADOPTED');
    d.approval.summary.flows = [flow, { ...flow, name: 'Digest again' }] as never;
    const props = reactiveProps<Record<string, unknown>>({ data: d, form: null });
    const m = mountComponent(Page as never, props); mounted.push(m as never);
    expect(m.target.textContent).toContain('Digest again');
  });
});

describe('the enhanced submit (BLIND P3)', () => {
  it('a stale hash re-reads the page once, with the form kept, and submits nothing more', async () => {
    const { t, props } = open('UNADOPTED');
    const updates: unknown[] = [];
    await submitEnhancedWithResult(approveForm(t)!, { type: 'failure', status: 409, data: { code: 'stale' } }, {
      update: async (o) => { updates.push(o); props.form = { code: 'stale' }; },
    });
    expect(updates).toEqual([{ reset: false }]);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(0);
  });

  it('a success or a refusal does not re-read by hand (update does it for a success)', async () => {
    const { t } = open('UNADOPTED');
    await submitEnhancedWithResult(approveForm(t)!, { type: 'success', status: 200, data: { approved: true } });
    await submitEnhancedWithResult(approveForm(t)!, { type: 'failure', status: 403, data: { code: 'refused', message: 'no' } });
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });

  it('the buttons are disabled while a submit is in flight and free again after', async () => {
    const { t } = open('UNADOPTED');
    const form = approveForm(t)!;
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const run = submitEnhancedWithResult(form, { type: 'success', status: 200, data: { approved: true } }, { update: async () => { await held; } });
    await tick(); flushSync();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    release(); await run; flushSync();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
});
