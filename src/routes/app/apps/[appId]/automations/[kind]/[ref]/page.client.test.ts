/**
 * portal#1299 — the approval page's client behaviour: Decline's own
 * confirmation (and that it belongs to ONE automation), where focus goes, and
 * what the enhanced submit does with the server's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { beginEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const summary = (name = 'Nightly digest') => ({ name, schedule: 'Runs daily.', reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] });
const data = (state: string, ref = 'sch-1', name = 'Nightly digest', hash = 'h1') =>
  ({ app, kind: 'SCHEDULE', ref, approval: { state, hash, depth: {}, summary: summary(name) }, teamGrant: { status: 'hidden' } });
const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => { resetNavigationCalls(); });
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.restoreAllMocks(); });
function open(state: string, form: unknown = null) {
  const props = reactiveProps<Record<string, unknown>>({ data: data(state), form });
  const m = mountComponent(Page as never, props);
  mounted.push(m as never);
  return { t: m.target as HTMLElement, props };
}
const button = (t: HTMLElement, label: string) => [...t.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const declineForm = (t: HTMLElement) => t.querySelector<HTMLFormElement>('form[action="?/decline"]');
// Focus moves in a continuation after the render, so settle past both.
const settle = async () => { flushSync(); await tick(); await tick(); };
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
    button(t, 'Decline')!.click(); await settle();
    const confirm = t.querySelector<HTMLElement>('[data-testid="decline-confirmation"]')!;
    expect(confirm).toBeTruthy();
    expect(confirm.contains(document.activeElement)).toBe(true);
    button(t, 'Cancel')!.click(); await settle();
    expect(document.activeElement).toBe(button(t, 'Decline'));
  });

  it('after a submit the outcome is where focus goes, since the button that sent it is gone', async () => {
    const { t, props } = open('UNADOPTED');
    await submitEnhancedWithResult(approveForm(t)!, { type: 'success', status: 200, data: { approved: true } }, {
      update: async () => { props.data = data('ADOPTED'); props.form = { approved: true }; },
    });
    await settle();
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

// portal#1650: the grant's control always shows the stored state, because a
// refused write re-reads it rather than leaving the page's guess on screen.
describe('team roster and tasks', () => {
  const live = { id: 'g1', createdAt: '2026-11-01T10:00:00.000Z', revokedAt: null, givenBy: { name: 'Ana', urn: 'hrn:user:ana' }, endedBy: null };
  const withGrant = (teamGrant: unknown, ref = 'sch-1') => ({ ...data('ADOPTED', ref), teamGrant });
  function openGrant(teamGrant: unknown) {
    const props = reactiveProps<Record<string, unknown>>({ data: withGrant(teamGrant), form: null });
    const m = mountComponent(Page as never, props);
    mounted.push(m as never);
    return { t: m.target as HTMLElement, props };
  }
  const form = (t: HTMLElement, action: string) => t.querySelector<HTMLFormElement>(`form[action="?/${action}"]`);
  const reReads = () => navigationCalls.filter((c) => c.fn === 'invalidateAll').length;
  const refused = { type: 'failure' as const, status: 403, data: { teamGrantRefused: true, teamGrantMessage: 'No.' } };
  const given = { type: 'success' as const, status: 200, data: { teamGrant: 'given' } };

  it('a refused Give re-reads the stored state and moves focus to what happened', async () => {
    const { t, props } = openGrant({ status: 'ready', live: null, ended: null });
    await submitEnhancedWithResult(form(t, 'give')!, refused, { update: async () => { props.form = refused.data; } });
    await settle();
    expect(reReads()).toBe(1);
    expect(document.activeElement).toBe(t.querySelector('[data-testid="team-grant-outcome"]'));
    expect(form(t, 'give')).not.toBeNull();
    expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
  });

  it('a Give that went through is not re-read twice: the form update does it', async () => {
    const { t } = openGrant({ status: 'ready', live: null, ended: null });
    await submitEnhancedWithResult(form(t, 'give')!, given);
    await settle();
    expect(reReads()).toBe(0);
  });

  describe('a write in flight belongs to the one submit that sent it (LOCAL P2-1)', () => {
    const none = { status: 'ready', live: null, ended: null };
    const pressed = (t: HTMLElement) => form(t, 'give')!.querySelector('button')!;
    const noted = () => {
      const seen: unknown[] = [];
      return { seen, update: async (o?: unknown) => { seen.push(o); } };
    };

    it('A, then B, then back to A: A\'s late answer touches nothing on the fresh page', async () => {
      const { t, props } = openGrant(none);
      const old = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, old);
      props.data = withGrant(none, 'sch-2'); await settle();
      props.data = withGrant(none, 'sch-1'); await settle();
      await deliver(given); await settle();
      expect(old.seen).toEqual([]);
      expect(document.activeElement).not.toBe(t.querySelector('[data-testid="team-grant-outcome"]'));
    });

    it('A\'s late answer does not free B\'s button while B\'s own write is pending', async () => {
      const { t, props } = openGrant(none);
      const deliverA = await beginEnhanced(form(t, 'give')!, noted());
      props.data = withGrant(none, 'sch-2'); await settle();
      expect(pressed(t).disabled).toBe(false);
      const deliverB = await beginEnhanced(form(t, 'give')!, noted());
      await settle();
      expect(pressed(t).disabled).toBe(true);
      await deliverA(given); await settle();
      expect(pressed(t).disabled).toBe(true);
      await deliverB(given); await settle();
      expect(pressed(t).disabled).toBe(false);
    });

    it('the current submit still applies, frees the button and moves focus', async () => {
      const { t } = openGrant(none);
      const own = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, own);
      await settle();
      expect(pressed(t).disabled).toBe(true);
      await deliver(given); await settle();
      expect(own.seen).toEqual([{ reset: false }]);
      expect(pressed(t).disabled).toBe(false);
      expect(document.activeElement).toBe(t.querySelector('[data-testid="team-grant-outcome"]'));
    });

    it('a reload of the same automation does not disown the write in flight', async () => {
      const { t, props } = openGrant(none);
      const own = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, own);
      props.data = withGrant({ ...none }); await settle();
      await deliver(given); await settle();
      expect(own.seen).toEqual([{ reset: false }]);
    });

    it('after the page is gone its answer does nothing and throws nothing', async () => {
      const { t } = openGrant(none);
      const old = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, old);
      mounted.pop()!.unmount();
      await deliver(given);
      expect(old.seen).toEqual([]);
      expect(reReads()).toBe(0);
    });
  });

  describe('a write whose re-read fails (LOCAL P2-2)', () => {
    const none = { status: 'ready', live: null, ended: null };
    const STALE = "This page couldn't be refreshed";
    const brokenReload = async () => { throw new Error('reload failed'); };
    const consoleWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

    it('a Give that went through says so, says the page may be behind, and frees the button', async () => {
      consoleWarn();
      const { t } = openGrant(none);
      await submitEnhancedWithResult(form(t, 'give')!, given, { update: brokenReload });
      await settle();
      expect(t.textContent).toContain('Given.');
      expect(t.textContent).toContain(STALE);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
      expect(document.activeElement).toBe(t.querySelector('[data-testid="team-grant-outcome"]'));
    });

    it('a Stop that went through says Stopped, not Given', async () => {
      consoleWarn();
      const { t } = openGrant({ status: 'ready', live, ended: null });
      await submitEnhancedWithResult(form(t, 'stop')!, { type: 'success', status: 200, data: { teamGrant: 'stopped' } }, { update: brokenReload });
      await settle();
      expect(t.textContent).toContain('Stopped.');
      expect(t.textContent).toContain(STALE);
    });

    it('a refusal whose re-read fails keeps the refusal and frees the button', async () => {
      consoleWarn();
      const { t, props } = openGrant(none);
      navigationHooks.onInvalidateAll = brokenReload;
      await submitEnhancedWithResult(form(t, 'give')!, refused, { update: async () => { props.form = refused.data; } });
      await settle();
      expect(t.textContent).toContain('No.');
      expect(t.textContent).toContain(STALE);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
    });

    it('sends nothing again on its own', async () => {
      consoleWarn();
      const { t } = openGrant(none);
      let sent = 0;
      await submitEnhancedWithResult(form(t, 'give')!, given, { update: async () => { sent += 1; throw new Error('reload failed'); } });
      await settle();
      expect(sent).toBe(1);
      expect(reReads()).toBe(0);
    });

    it('the note goes once the page has read the stored state again', async () => {
      consoleWarn();
      const { t, props } = openGrant(none);
      await submitEnhancedWithResult(form(t, 'give')!, given, { update: brokenReload });
      await settle();
      props.data = withGrant({ status: 'ready', live, ended: null }); await settle();
      expect(t.textContent).not.toContain(STALE);
    });

    it('a reload that fails after the page moved on says nothing on the page it moved to', async () => {
      consoleWarn();
      const { t, props } = openGrant(none);
      const deliver = await beginEnhanced(form(t, 'give')!, { update: async () => {
        props.data = withGrant(none, 'sch-2'); await settle();
        throw new Error('reload failed');
      } });
      await deliver(given); await settle();
      expect(t.textContent).not.toContain(STALE);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
    });
  });

  it('a refused Give that leaves the viewer no longer a manager still says it was refused (QA P2)', async () => {
    const { t, props } = openGrant({ status: 'ready', live: null, ended: null });
    navigationHooks.onInvalidateAll = () => { props.data = withGrant({ status: 'hidden' }); };
    await submitEnhancedWithResult(form(t, 'give')!, refused, { update: async () => { props.form = refused.data; } });
    await settle();
    expect(t.textContent).not.toContain('Team roster and tasks');
    expect(t.querySelector('[role="alert"]')!.textContent).toContain('No.');
    expect(document.activeElement).toBe(t.querySelector('[data-testid="team-grant-outcome"]'));
  });

  it('the control follows the stored state, not the last press', async () => {
    const { t, props } = openGrant({ status: 'ready', live: null, ended: null });
    props.data = withGrant({ status: 'ready', live, ended: null });
    await settle();
    expect(form(t, 'give')).toBeNull();
    expect(form(t, 'stop')).not.toBeNull();
    props.data = withGrant({ status: 'ready', live: null, ended: null });
    await settle();
    expect(form(t, 'stop')).toBeNull();
    expect(form(t, 'give')).not.toBeNull();
  });

  it('ended grants are the shared table, with who ended them and when', async () => {
    const ended = { id: 'g0', createdAt: '2026-10-01T10:00:00.000Z', revokedAt: '2026-10-20T10:00:00.000Z', givenBy: { name: 'Ana', urn: 'hrn:user:ana' }, endedBy: null };
    const { t } = openGrant({ status: 'ready', live: null, ended: [ended] });
    await settle();
    const table = t.querySelector('[data-testid="team-grant-ended"] table');
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain('Ana');
    expect(table!.textContent).toContain('Oct 20, 2026');
  });
});
