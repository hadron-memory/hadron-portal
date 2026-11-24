/**
 * portal#2578 (LOCAL review of #2571): the secrets list's live regions are announced only if the
 * region ALREADY exists when its content changes. The server render cannot see that, so this runs
 * in the client lane: the same element must hold the text before and after, and be there while quiet.
 */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import List from './+page.svelte';
import PendingUnread from '$lib/components/secrets/PendingUnread.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const data = { app, secrets: { kind: 'ok', secrets: [] }, signing: 'on', pending: [], pendingUnchecked: 0, impersonating: null };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); document.body.innerHTML = ''; });

const live = (t: HTMLElement) => [...t.querySelectorAll<HTMLElement>('[aria-live="polite"], [role="status"]')];

it('the pending notice region is mounted while quiet, and the same element carries the note when it appears', async () => {
  const props = reactiveProps({ count: 0 } as Record<string, unknown>);
  const m = mountComponent(PendingUnread as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(4);
  const region = m.target.querySelector<HTMLElement>('[data-testid="pending-unread-region"]');
  expect(region).not.toBeNull();
  expect(region!.getAttribute('role') === 'status' || region!.getAttribute('aria-live') === 'polite').toBe(true);
  expect(region!.textContent?.trim()).toBe('');

  props.count = 2; await tick(4);
  expect(m.target.querySelector('[data-testid="pending-unread-region"]')).toBe(region); // not a new element
  expect(region!.textContent).toContain('2 change requests');

  props.count = 0; await tick(4);
  expect(m.target.querySelector('[data-testid="pending-unread-region"]')).toBe(region); // and it stays when quiet
  expect(region!.textContent?.trim()).toBe('');
});

it('the withdraw and create result regions exist before a result and keep their element when one arrives', async () => {
  const props = reactiveProps({ data, form: null } as Record<string, unknown>);
  const m = mountComponent(List as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(6);
  const before = live(m.target).filter((r) => r.getAttribute('aria-live') === 'polite');
  // The withdraw and the create result regions: both present and empty with no form result.
  expect(before.length).toBeGreaterThanOrEqual(2);
  expect(before.every((r) => r.textContent?.trim() === '')).toBe(true);

  props.form = { action: 'create', name: 'k', message: 'Use lowercase letters.' }; await tick(6);
  const after = live(m.target).filter((r) => r.getAttribute('aria-live') === 'polite');
  expect(after).toEqual(before); // the same elements, in the same order
  const withText = after.filter((r) => r.textContent?.includes('Use lowercase letters.'));
  expect(withText).toHaveLength(1);
  expect(withText[0].querySelector('[data-testid="create-error"]')).not.toBeNull();

  props.form = { action: 'withdraw', message: 'Nothing was withdrawn.' }; await tick(6);
  const again = live(m.target).filter((r) => r.getAttribute('aria-live') === 'polite');
  expect(again).toEqual(before);
  expect(again.filter((r) => r.querySelector('[data-testid="withdraw-error"]'))).toHaveLength(1);
});
