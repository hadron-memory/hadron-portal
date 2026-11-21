import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import LiveOutcomeHost from '$lib/test/fixtures/LiveOutcomeHost.svelte';

// portal#2379 / portal#2344: an outcome that is a status on success and an alert on failure keeps
// BOTH regions mounted; only the content moves between them.
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const status = (t: HTMLElement) => t.querySelector<HTMLElement>('[role="status"]')!;
const alert = (t: HTMLElement) => t.querySelector<HTMLElement>('[role="alert"]')!;
const say = (note: { text: string; failed: boolean } | null) => { (mounted!.instance.say as (n: unknown) => void)(note); flushSync(); };
async function mount() {
  mounted = mountComponent(LiveOutcomeHost as never, {} as never) as Mounted<Record<string, unknown>>;
  await tick(2);
  return mounted.target;
}

describe('LiveOutcome', () => {
  it('has both regions mounted and empty before there is an outcome', async () => {
    const t = await mount();
    expect(status(t).getAttribute('aria-live')).toBe('polite');
    expect(status(t).textContent?.trim()).toBe('');
    expect(alert(t).textContent?.trim()).toBe('');
  });

  it('puts a success in the status region and a failure in the alert region, keeping both elements', async () => {
    const t = await mount();
    const [s, a] = [status(t), alert(t)];
    say({ text: 'Saved', failed: false });
    expect(status(t)).toBe(s); expect(alert(t)).toBe(a);
    expect(s.querySelector('.host-box')?.textContent).toBe('Saved');
    expect(a.textContent?.trim()).toBe('');
    say({ text: 'Refused', failed: true });
    expect(status(t)).toBe(s); expect(alert(t)).toBe(a);
    expect(s.textContent?.trim()).toBe('');
    expect(a.querySelector('.host-box')?.textContent).toBe('Refused');
    say(null);
    expect(status(t)).toBe(s); expect(alert(t)).toBe(a);
    expect(s.textContent?.trim()).toBe('');
    expect(a.textContent?.trim()).toBe('');
  });

  it('carries the caller class and empty:m-0 on both regions', async () => {
    const t = await mount();
    for (const el of [status(t), alert(t)]) {
      const cls = el.className.split(/\s+/);
      expect(cls).toContain('host-outcome');
      expect(cls).toContain('empty:m-0');
    }
  });
});
