/**
 * portal#1701 — the schedule form in a real DOM: the zone a new schedule sends is the browser's (read in onMount),
 * an edit keeps the stored zone and keeps timing the plain controls cannot express until the user asks to change it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import ScheduleForm from './ScheduleForm.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks(); });

const base = { nodeMemories: { kind: 'ok', value: [] }, submitLabel: 'Save' };
const entry = 'hrn:node:acme.com:m:e';
async function show(props: Record<string, unknown>) {
  const m = mountComponent(ScheduleForm as never, { ...base, ...props } as never) as Mounted<Record<string, unknown>>;
  mounted = m;
  await tick(3);
  return m.target;
}
const field = (t: HTMLElement, name: string) => t.querySelector<HTMLInputElement>(`[name="${name}"]`);
const click = (el: Element | null) => { (el as HTMLElement).click(); flushSync(); };

describe('create', () => {
  const initial = { name: '', entryNodeUrn: '', entryName: null, timing: null, timezone: null };
  it('sends the browser’s zone, read after mount', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Tokyo' } as never);
    const t = await show({ mode: 'create', initial });
    expect(field(t, 'zone')!.value).toBe('Asia/Tokyo');
    expect(t.querySelector('[data-testid="schedule-form-zone"]')!.textContent).toContain('Asia/Tokyo');
  });
  it('sends an empty zone, not a guess, when the browser cannot say', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => { throw new Error('no intl'); });
    const t = await show({ mode: 'create', initial });
    expect(field(t, 'zone')!.value).toBe('');
  });
  it('has no name field and carries no cron', async () => {
    const t = await show({ mode: 'create', initial });
    expect(field(t, 'name')).toBeNull();
    expect(field(t, 'cron')).toBeNull();
  });
  it('Create stays off while canSubmit is false and says why', async () => {
    const t = await show({ mode: 'create', initial, canSubmit: false, blockedReason: 'Waiting for the summary.' });
    expect(t.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(t.textContent).toContain('Waiting for the summary.');
  });
});

describe('edit', () => {
  const daily = { name: 'Digest', entryNodeUrn: entry, entryName: null, timing: { kind: 'daily', time: '09:00' }, timezone: 'Europe/Berlin' };
  const custom = { ...daily, timing: { kind: 'custom', cron: '*/5 * * * *' } };
  it('shows the stored choice, in the stored zone, and sends no zone field', async () => {
    const t = await show({ mode: 'edit', initial: daily });
    expect(field(t, 'when')?.getAttribute('value')).toBeTruthy();
    expect(t.querySelector<HTMLInputElement>('input[name="when"]:checked')!.value).toBe('daily');
    expect(field(t, 'time')!.value).toBe('09:00');
    expect(field(t, 'zone')).toBeNull();
    expect(t.querySelector('[data-testid="schedule-form-zone"]')!.textContent).toContain('Europe/Berlin');
  });
  it('the stored name and entry are in the form for the server to compare', async () => {
    const t = await show({ mode: 'edit', initial: daily });
    expect(field(t, 'name')!.value).toBe('Digest');
    expect(field(t, 'entryNodeUrn')!.value).toBe(entry);
  });
  it('custom timing is shown as it is and posts keepTiming, with no timing controls', async () => {
    const t = await show({ mode: 'edit', initial: custom });
    expect(t.querySelector('[data-testid="schedule-form-kept-timing"]')!.textContent).toContain('*/5 * * * *');
    expect(field(t, 'keepTiming')!.value).toBe('1');
    expect(field(t, 'when')).toBeNull();
  });
  it('“Change when it runs” swaps in the plain controls and stops posting keepTiming', async () => {
    const t = await show({ mode: 'edit', initial: custom });
    click([...t.querySelectorAll('button')].find((b) => b.textContent?.includes('Change when it runs')) ?? null);
    expect(field(t, 'keepTiming')).toBeNull();
    expect(t.querySelectorAll('input[name="when"]')).toHaveLength(4);
  });
  it('a schedule with no timing at all is kept too, not defaulted to daily', async () => {
    const t = await show({ mode: 'edit', initial: { ...daily, timing: null } });
    expect(field(t, 'keepTiming')!.value).toBe('1');
  });
  it('shows a field error under its field', async () => {
    const t = await show({ mode: 'edit', initial: daily, failure: { field: 'time', message: 'Pick a time of day.' } });
    expect(t.querySelector('[role="alert"]')!.textContent).toBe('Pick a time of day.');
  });
});

describe('LOCAL P2-3 and P2-4', () => {
  it('shows a stored one-shot at its wall date and time in the stored zone', async () => {
    const t = await show({ mode: 'edit', initial: { name: 'Once', entryNodeUrn: entry, entryName: null, timing: { kind: 'once', at: '2026-11-05T13:45:00.000Z' }, timezone: 'Europe/Berlin' } });
    expect(t.querySelector<HTMLInputElement>('input[name="when"]:checked')!.value).toBe('once');
    expect(field(t, 'date')!.value).toBe('2026-11-05');
    expect(field(t, 'time')!.value).toBe('14:45');
  });
  it('a refused create is visible on the create screen, in plain words', async () => {
    const t = await show({ mode: 'create', initial: { name: '', entryNodeUrn: entry, entryName: null, timing: null, timezone: null }, failure: { field: 'create', message: 'Only an organization admin can create a schedule.' } });
    expect(t.querySelector('[data-testid="schedule-form-create-failure"]')!.textContent).toContain('Only an organization admin');
  });
});
