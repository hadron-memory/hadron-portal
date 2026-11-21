/** portal#2376 — the team-grant section's availability notes are persistent LiveRegions (before / during / after). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { expectLiveRegionLifecycle } from '$lib/test/expectLiveRegionLifecycle';
import TeamGrantSection from './TeamGrantSection.svelte';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const none = () => ({ status: 'ready', live: null, ended: null });
function open(grant: unknown) {
  const props = reactiveProps<Record<string, unknown>>({ grant, identity: 'sch-1', href: '/app/apps/app-1/automations/schedule/sch-1', form: null });
  const m = mountComponent(TeamGrantSection as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { root: m.target, props };
}

describe('team grant section spacing (portal#2376)', () => {
  it('the last outcome region cancels the space-y unit it would leave behind when empty', () => {
    const { root } = open(none());
    const region = root.querySelector('[data-testid="team-grant-outcome"]')!.querySelectorAll<HTMLElement>('[role="status"]');
    expect(region[region.length - 1]!.className).toContain('last:idle:-mt-2');
  });
});

describe('team grant section notes', () => {
  it('this could not be read', async () => {
    const { root, props } = open(none());
    await expectLiveRegionLifecycle({ root, text: 'This couldn\'t be read.', settle: () => tick(2),
      appear: () => { props.grant = { status: 'unavailable' }; }, disappear: () => { props.grant = none(); } });
  });

  it('the page could not be refreshed after a write', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root, props } = open(none());
    const give = root.querySelector<HTMLFormElement>('form[action="?/give"]')!;
    await expectLiveRegionLifecycle({ root, text: 'This page couldn\'t be refreshed', settle: () => tick(2),
      // Kit failing to apply the answer is the section's own "couldn't refresh" outcome.
      appear: async () => { await submitEnhancedWithResult(give, { type: 'success', status: 200, data: { teamGrant: 'given' } }, { update: async () => { throw new Error('apply failed'); } }); },
      // The next load of the page replaces the stored state, so nothing is behind any more.
      disappear: () => { props.grant = none(); } });
  });
});
