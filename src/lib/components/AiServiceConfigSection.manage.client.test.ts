/**
 * portal#2567: the section shows the controls to whoever its caller says may manage,
 * and a read-only line that names the right owner. CLIENT lane: the render is the point.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import AiServiceConfigSection from './AiServiceConfigSection.svelte';
import { resetAiConfigRecoveryForTests } from './ai-config-recovery';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetAiConfigRecoveryForTests();
  vi.unstubAllGlobals();
});

async function open(props: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: [] }))));
  const m = mountComponent(AiServiceConfigSection as never, {
    ownerType: 'APP', ownerId: 'a1', ownerLabel: 'Team', ownerUrn: 'hrn:app:acme.com:team',
    configs: [], currentUserId: 'u1', ...props,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}
const hasAdd = (t: HTMLElement) => [...t.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add configuration');

it('canManage renders the add control and not the read-only line, on a person\'s App with no organization anywhere', async () => {
  const t = await open({ canManage: true, ownerIsPerson: true });
  expect(hasAdd(t)).toBe(true);
  expect(t.textContent).not.toContain('Only the owner');
  expect(t.textContent).not.toContain('Only organization admins');
});

it('not canManage on a person\'s App says only its owner can, and offers no add (render control for the case above)', async () => {
  const t = await open({ canManage: false, ownerIsPerson: true });
  expect(hasAdd(t)).toBe(false);
  expect(t.textContent).toContain('Only the owner of this App can manage its AI service configurations.');
  expect(t.textContent).not.toContain('organization');
});

it('not canManage on a person\'s Agent names the Agent', async () => {
  const t = await open({ ownerType: 'AGENT', ownerId: 'ag1', canManage: false, ownerIsPerson: true });
  expect(t.textContent).toContain('Only the owner of this Agent can manage its AI service configurations.');
});

it('not canManage on an organization\'s App keeps the admin line', async () => {
  const t = await open({ canManage: false });
  expect(t.textContent).toContain('Only organization admins can manage AI service configurations.');
  expect(t.textContent).not.toContain('Only the owner');
});
