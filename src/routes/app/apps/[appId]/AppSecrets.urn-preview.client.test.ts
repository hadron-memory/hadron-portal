/** The Secrets form shows the URN a name will have, as it is typed, so it can be copied into an automation. */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import AppSecrets from './AppSecrets.svelte';

const panel = { secrets: { kind: 'ok', secrets: [] }, signing: 'off', pending: [], pendingUnchecked: 0, impersonating: null };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); document.body.innerHTML = ''; });

async function type(m: Mounted<Record<string, unknown>>, v: string) {
  const input = m.target.querySelector<HTMLInputElement>('#secret-name')!;
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(4);
}
const preview = (m: Mounted<Record<string, unknown>>) => m.target.querySelector('[data-testid="secret-urn-preview"]');

it('shows the full secret URN for a valid name and drops it for an invalid or empty one', async () => {
  const m = mountComponent(AppSecrets as never, { appId: 'a1', appUrn: 'hrn:app:acme.com:billing', panel, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(4);
  expect(preview(m)).toBeNull();
  await type(m, 'db-password');
  expect(preview(m)?.querySelector('[title]')?.getAttribute('title')).toBe('hrn:secret:acme.com:app:billing:db-password');
  await type(m, '  db-password  ');
  expect(preview(m)?.querySelector('[title]')?.getAttribute('title')).toBe('hrn:secret:acme.com:app:billing:db-password');
  await type(m, 'Bad Name');
  expect(preview(m)).toBeNull();
  await type(m, '');
  expect(preview(m)).toBeNull();
});

it('shows nothing when the App URN is not known', async () => {
  const m = mountComponent(AppSecrets as never, { appId: 'a1', panel, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(4);
  await type(m, 'db-password');
  expect(preview(m)).toBeNull();
});
