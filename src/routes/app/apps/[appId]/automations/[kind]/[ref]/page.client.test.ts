/**
 * portal#1299 — the approval page's client behaviour: Decline's own
 * confirmation (and that it belongs to ONE automation), where focus goes, and
 * what the enhanced submit does with the server's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { beginEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const summary = (name = 'Nightly digest') => ({ name, schedule: 'Runs daily.', reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] });
const data = (state: string, ref = 'sch-1', name = 'Nightly digest', hash = 'h1') =>
  ({ app, kind: 'SCHEDULE', ref, approval: { state, hash, depth: {}, summary: summary(name) }, teamGrant: { status: 'hidden' } });
// An approved SCHEDULE has no Decline (Pause is its stop), so the Decline mechanics are exercised on a webhook.
const declineData = (state: string, ref = 'sch-1', name = 'Nightly digest', hash = 'h1') => ({ ...data(state, ref, name, hash), kind: 'WEBHOOK' });
const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => { resetNavigationCalls(); });
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.restoreAllMocks(); });
function open(state: string, form: unknown = null) {
  const props = reactiveProps<Record<string, unknown>>({ data: declineData(state), form });
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
    props.data = declineData('ADOPTED', 'sch-2', 'Weekly report', 'h2'); flushSync();
    expect(t.querySelector('h1')!.textContent).toBe('Weekly report');
    expect(declineForm(t)).toBeNull();
    expect(button(t, 'Decline')).toBeTruthy();
  });

  it('and coming back to A does not reopen it', () => {
    const { t, props } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    props.data = declineData('ADOPTED', 'sch-2', 'Weekly report', 'h2'); flushSync();
    props.data = declineData('ADOPTED'); flushSync();
    expect(t.querySelector('h1')!.textContent).toBe('Nightly digest');
    expect(declineForm(t)).toBeNull();
  });

  it('a reload of the SAME automation keeps the confirmation open', () => {
    const { t, props } = open('ADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    props.data = declineData('ADOPTED', 'sch-1', 'Nightly digest', 'h-reloaded'); flushSync();
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
      update: async () => { props.data = declineData('ADOPTED'); props.form = { approved: true }; },
    });
    await settle();
    const notice = t.querySelector<HTMLElement>('[data-testid="automation-outcome"]')!;
    expect(notice.textContent).toContain('Approved.');
    expect(document.activeElement).toBe(notice);
  });
});

describe('Decline eligibility follows the loader state (LOCAL delta2 P2)', () => {
  const scheduleData = (state: string) => data(state);
  it('a confirmation opened while UNADOPTED closes when the same schedule turns ADOPTED, and stays closed', () => {
    const props = reactiveProps<Record<string, unknown>>({ data: scheduleData('UNADOPTED'), form: null });
    const m = mountComponent(Page as never, props); mounted.push(m as never);
    const t = m.target as HTMLElement;
    button(t, 'Decline')!.click(); flushSync();
    expect(declineForm(t)).not.toBeNull();
    props.data = scheduleData('ADOPTED'); flushSync();
    expect(declineForm(t)).toBeNull();
    expect(button(t, 'Decline')).toBeUndefined();
    props.data = scheduleData('UNADOPTED'); flushSync();
    expect(declineForm(t)).toBeNull();
    expect(button(t, 'Decline')).toBeDefined();
  });

  it('a webhook keeps its confirmation across the same transition', () => {
    const { t, props } = open('UNADOPTED');
    button(t, 'Decline')!.click(); flushSync();
    props.data = declineData('ADOPTED'); flushSync();
    expect(declineForm(t)).not.toBeNull();
  });
});

describe('malformed server data (BLIND P3)', () => {
  it('two flows that share a URN both render instead of throwing a duplicate-key error', () => {
    const flow = { name: 'Digest', urn: 'hrn:node:acme.com:team:flows:digest', tools: [], writes: [] };
    const d = declineData('UNADOPTED');
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
  const none = { status: 'ready', live: null, ended: null };
  const given = { type: 'success' as const, status: 200, data: { teamGrant: 'given' } };
  const stopped = { type: 'success' as const, status: 200, data: { teamGrant: 'stopped' } };
  const refused = { type: 'failure' as const, status: 403, data: { teamGrantRefused: true, teamGrantMessage: 'No.' } };
  const outcomeBox = (t: HTMLElement) => t.querySelector('[data-testid="team-grant-outcome"]');
  const STALE = "This page couldn't be refreshed";
  /** Kit's own applying, as the page sees it: `form` changes, nothing is re-read. */
  const applying = (props: Record<string, unknown>, result: { data: unknown }) => ({ update: async () => { props.form = result.data; } });

  // A re-read goes through the section's own endpoint. A failed __data read is
  // kit's error page over the whole page, so the page could not report it
  // (hrn:node:hadronmemory.com:hadron-portal:findings:section-retry-owns-its-re-read).
  // navigationCalls stays empty: that is the pin that the page cannot be replaced.
  type Answer = { body: unknown; status?: number } | { status: number } | { reject: Error };
  let reads: string[];
  let answer: Answer;
  let held: Promise<void> | null;
  const holdRead = () => { let release!: () => void; held = new Promise<void>((r) => (release = r)); return release; };
  beforeEach(() => {
    reads = []; answer = { body: none }; held = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      reads.push(String(input));
      const mine = answer, wait = held;
      held = null;
      await wait;
      if ('reject' in mine) throw mine.reject;
      if ('body' in mine) return new Response(JSON.stringify(mine.body), { status: mine.status ?? 200 });
      return new Response('{"error":"x"}', { status: mine.status });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  describe('after a write the section reads its own state again', () => {
    it('a Give asks kit only to apply the answer, then reads the stored state and shows it', async () => {
      const { t, props } = openGrant(none);
      answer = { body: { status: 'ready', live, ended: null } };
      const updates: unknown[] = [];
      await submitEnhancedWithResult(form(t, 'give')!, given, { update: async (o) => { updates.push(o); props.form = given.data; } });
      await settle();
      expect(updates).toEqual([{ reset: false, invalidateAll: false }]);
      expect(reads).toEqual(['/app/apps/app-1/automations/schedule/sch-1/team-grant']);
      expect(form(t, 'stop')).not.toBeNull();
      expect(t.textContent).toContain('Given.');
      expect(navigationCalls).toEqual([]);
    });

    it('a refused Give reads the stored state too and moves focus to what happened', async () => {
      const { t, props } = openGrant(none);
      await submitEnhancedWithResult(form(t, 'give')!, refused, applying(props, refused));
      await settle();
      expect(reads).toHaveLength(1);
      expect(navigationCalls).toEqual([]);
      expect(document.activeElement).toBe(outcomeBox(t));
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
    });

    it('with ended grants open it reads them too', async () => {
      const { t } = openGrant({ status: 'ready', live: null, ended: [] });
      await submitEnhancedWithResult(form(t, 'give')!, given);
      await settle();
      expect(reads).toEqual(['/app/apps/app-1/automations/schedule/sch-1/team-grant?ended=1']);
    });

    it('the copy it read gives way to the next load of the page', async () => {
      const { t, props } = openGrant(none);
      answer = { body: { status: 'ready', live, ended: null } };
      await submitEnhancedWithResult(form(t, 'give')!, given);
      await settle();
      expect(form(t, 'stop')).not.toBeNull();
      props.data = withGrant({ ...none }); await settle();
      expect(form(t, 'give')).not.toBeNull();
    });

    it('a read that says it could not read keeps the outcome above the section\'s own line', async () => {
      const { t, props } = openGrant(none);
      answer = { body: { status: 'unavailable' } };
      await submitEnhancedWithResult(form(t, 'give')!, given, applying(props, given));
      await settle();
      expect(t.textContent).toContain('Given.');
      expect(t.querySelector('[data-testid="team-grant-unavailable"]')).not.toBeNull();
      expect(t.textContent).not.toContain(STALE);
    });
  });

  describe('a write in flight belongs to the one submit that sent it (LOCAL P2-1)', () => {
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
      expect(reads).toEqual([]);
      expect(document.activeElement).not.toBe(outcomeBox(t));
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

    it('the answer is applied before any waiting, so leaving during the re-read cannot apply it later', async () => {
      const { t, props } = openGrant(none);
      const order: string[] = [];
      const release = holdRead();
      const deliver = await beginEnhanced(form(t, 'give')!, { update: async () => { order.push('applied'); props.form = given.data; } });
      const delivered = deliver(given);
      await settle();
      expect(order).toEqual(['applied']);
      expect(reads).toHaveLength(1);
      props.form = null;
      answer = { body: { status: 'ready', live, ended: null } };
      props.data = withGrant(none, 'sch-2'); await settle();
      props.data = withGrant(none, 'sch-1'); await settle();
      release(); await delivered; await settle();
      expect(order).toEqual(['applied']);
      expect(outcomeBox(t)?.textContent ?? '').not.toContain('Given.');
      expect(form(t, 'give')).not.toBeNull();
      expect(document.activeElement).not.toBe(outcomeBox(t));
    });

    it('leaving while the answer is being applied starts no re-read', async () => {
      const { t, props } = openGrant(none);
      let applied!: () => void;
      const applying = new Promise<void>((r) => (applied = r));
      const deliver = await beginEnhanced(form(t, 'give')!, { update: () => applying });
      const delivered = deliver(given);
      await settle();
      props.data = withGrant(none, 'sch-2'); await settle();
      applied(); await delivered; await settle();
      expect(reads).toEqual([]);
    });

    it('a late read does not free B\'s button either, or show on B', async () => {
      const { t, props } = openGrant(none);
      const release = holdRead();
      const deliverA = await beginEnhanced(form(t, 'give')!, noted());
      const deliveredA = deliverA(given);
      await settle();
      props.data = withGrant(none, 'sch-2'); await settle();
      const deliverB = await beginEnhanced(form(t, 'give')!, noted());
      await settle();
      release(); await deliveredA; await settle();
      expect(pressed(t).disabled).toBe(true);
      expect(form(t, 'give')).not.toBeNull();
      await deliverB(given); await settle();
    });

    it('the current submit still applies, frees the button and moves focus', async () => {
      const { t } = openGrant(none);
      const own = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, own);
      await settle();
      expect(pressed(t).disabled).toBe(true);
      await deliver(given); await settle();
      expect(own.seen).toHaveLength(1);
      expect(pressed(t).disabled).toBe(false);
      expect(document.activeElement).toBe(outcomeBox(t));
    });

    it('a reload of the same automation does not disown the write in flight', async () => {
      const { t, props } = openGrant(none);
      const own = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, own);
      props.data = withGrant({ ...none }); await settle();
      await deliver(given); await settle();
      expect(own.seen).toHaveLength(1);
    });

    it('after the page is gone its answer does nothing and throws nothing', async () => {
      const { t } = openGrant(none);
      const old = noted();
      const deliver = await beginEnhanced(form(t, 'give')!, old);
      mounted.pop()!.unmount();
      await deliver(given);
      expect(old.seen).toEqual([]);
      expect(reads).toEqual([]);
    });
  });

  describe('a write whose re-read fails (LOCAL P2-2)', () => {
    const failures: [string, Answer][] = [
      ['the request fails', { reject: new Error('network') }],
      ['the endpoint answers an error', { status: 500 }],
      ['an error carries what looks like a grant', { status: 500, body: { status: 'ready', live: null, ended: null } }],
      ['the answer is malformed', { body: { status: 'ready', live: 'yes' } }],
    ];
    it.each(failures)('%s: the page stays, says what happened and frees the button', async (_name, broken) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t, props } = openGrant(none);
      answer = broken;
      await submitEnhancedWithResult(form(t, 'give')!, given, applying(props, given));
      await settle();
      expect(navigationCalls).toEqual([]);
      expect(t.textContent).toContain('Given.');
      expect(t.textContent).toContain(STALE);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
      expect(document.activeElement).toBe(outcomeBox(t));
    });

    it('an answer kit could not apply frees the button and says so', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t } = openGrant(none);
      await submitEnhancedWithResult(form(t, 'give')!, given, { update: async () => { throw new Error('apply failed'); } });
      await settle();
      expect(t.textContent).toContain(STALE);
      expect(reads).toEqual([]);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
    });

    it('a Stop says Stopped, not Given', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t, props } = openGrant({ status: 'ready', live, ended: null });
      answer = { status: 500 };
      await submitEnhancedWithResult(form(t, 'stop')!, stopped, applying(props, stopped));
      await settle();
      expect(t.textContent).toContain('Stopped.');
      expect(t.textContent).toContain(STALE);
    });

    it('a refusal keeps the refusal', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t, props } = openGrant(none);
      answer = { status: 500 };
      await submitEnhancedWithResult(form(t, 'give')!, refused, applying(props, refused));
      await settle();
      expect(t.textContent).toContain('No.');
      expect(t.textContent).toContain(STALE);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
    });

    it('sends nothing again on its own', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t } = openGrant(none);
      answer = { status: 500 };
      let sent = 0;
      await submitEnhancedWithResult(form(t, 'give')!, given, { update: async () => { sent += 1; } });
      await settle();
      expect(sent).toBe(1);
      expect(reads).toHaveLength(1);
    });

    it('the note goes once the page has read the stored state again', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t, props } = openGrant(none);
      answer = { status: 500 };
      await submitEnhancedWithResult(form(t, 'give')!, given);
      await settle();
      expect(t.textContent).toContain(STALE);
      props.data = withGrant({ status: 'ready', live, ended: null }); await settle();
      expect(t.textContent).not.toContain(STALE);
    });

    it('and the next submit starts without it', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t } = openGrant(none);
      answer = { status: 500 };
      await submitEnhancedWithResult(form(t, 'give')!, given);
      await settle();
      answer = { body: none };
      await submitEnhancedWithResult(form(t, 'give')!, given);
      await settle();
      expect(t.textContent).not.toContain(STALE);
    });

    it('a read that fails after the page moved on says nothing on the page it moved to', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { t, props } = openGrant(none);
      answer = { status: 500 };
      const release = holdRead();
      const deliver = await beginEnhanced(form(t, 'give')!);
      const delivered = deliver(given);
      await settle();
      props.data = withGrant(none, 'sch-2'); await settle();
      release(); await delivered; await settle();
      expect(t.textContent).not.toContain(STALE);
      expect(form(t, 'give')!.querySelector('button')!.disabled).toBe(false);
    });
  });

  it('a refused Give that leaves the viewer no longer a manager still says it was refused (QA P2)', async () => {
    const { t, props } = openGrant(none);
    answer = { body: { status: 'hidden' } };
    await submitEnhancedWithResult(form(t, 'give')!, refused, applying(props, refused));
    await settle();
    expect(t.textContent).not.toContain('Team roster and tasks');
    expect(t.querySelector('[role="alert"]')!.textContent).toContain('No.');
    expect(document.activeElement).toBe(outcomeBox(t));
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
