/**
 * portal#2578 (LOCAL review of #2571): the secrets list's live regions are announced only if the
 * region ALREADY exists when its content changes. The server render cannot see that, so this runs
 * in the client lane: the same element must hold the text before and after, and be there while quiet.
 */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import List from './AppSecrets.svelte';
import PendingUnread from '$lib/components/secrets/PendingUnread.svelte';

const panel = { secrets: { kind: 'ok', secrets: [] }, signing: 'on', pending: [], pendingUnchecked: 0, impersonating: null };
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
  const props = reactiveProps({ appId: 'app-1', panel, form: null } as Record<string, unknown>);
  const m = mountComponent(List as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(6);
  const before = live(m.target).filter((r) => r.getAttribute('aria-live') === 'polite');
  // The withdraw and the create result regions: both present and empty with no form result.
  expect(before.length).toBeGreaterThanOrEqual(2);
  expect(before.every((r) => r.textContent?.trim() === '')).toBe(true);

  props.form = { action: 'createSecret', name: 'k', message: 'Use lowercase letters.' }; await tick(6);
  const after = live(m.target).filter((r) => r.getAttribute('aria-live') === 'polite');
  expect(after).toHaveLength(before.length);
  after.forEach((r, i) => expect(r === before[i]).toBe(true)); // the same elements (identity, not structure), in the same order
  const withText = after.filter((r) => r.textContent?.includes('Use lowercase letters.'));
  expect(withText).toHaveLength(1);
  expect(withText[0].querySelector('[data-testid="create-error"]')).not.toBeNull();

  props.form = { action: 'withdrawSecret', message: 'Nothing was withdrawn.' }; await tick(6);
  const again = live(m.target).filter((r) => r.getAttribute('aria-live') === 'polite');
  expect(again).toHaveLength(before.length);
  again.forEach((r, i) => expect(r === before[i]).toBe(true));
  expect(again.filter((r) => r.querySelector('[data-testid="withdraw-error"]'))).toHaveLength(1);
});

const row = (state: string, requestId = 'r1') => ({ requestId, secretId: null, createName: 'k', ceremonyUrl: null, state, operation: 'CREATE', expiresAt: '2026-11-21T01:00:00Z' });
const notices = (t: HTMLElement) => t.querySelectorAll('[data-testid="pending-change"]').length;

// A request that ended is carried by ONE response and then dropped from the cookie. A later response without it
// (a re-read, a fresh page payload) must not take the notice away unseen. Open requests are not remembered.
it('an ended request stays shown when a later response no longer carries it; an open one goes', async () => {
  const props = reactiveProps({ appId: 'app-1', panel: { ...panel, pending: [row('completed', 'r1'), row('open', 'r2')] }, form: null } as Record<string, unknown>);
  const m = mountComponent(List as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(6);
  expect(notices(m.target)).toBe(2);

  props.panel = { ...panel, pending: [] }; await tick(6);
  expect(notices(m.target)).toBe(1); // the ended one stays; the open one is gone
  expect(m.target.textContent).toContain('creating this secret');
});
