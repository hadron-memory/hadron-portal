/**
 * portal#2567: the owner of a personal Agent is shown the AI-config controls. The section stays mounted
 * while hidden, so the AI tab's section is read straight from the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { resetAiConfigRecoveryForTests } from '$lib/components/ai-config-recovery';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetAiConfigRecoveryForTests();
  vi.unstubAllGlobals();
});

const OWNER_ONLY = 'Only the owner of this Agent can manage its AI service configurations.';
const ADMIN_ONLY = 'Only organization admins can manage AI service configurations.';

async function mountAi(over: Record<string, unknown>, agentOver: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: [] }), { headers: { 'Content-Type': 'application/json' } })));
  const data = await pageData('a', { mentionOnly: false }, agentOver);
  const m = mountComponent(Page as never, { data: { ...data, ...over }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target.querySelector<HTMLElement>('section.max-w-2xl')!;
}
const hasAdd = (p: HTMLElement) => [...p.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add configuration');

describe('a personal Agent, AI tab', () => {
  it('its owner sees the add control, not the admins-only line', async () => {
    const p = await mountAi({ canManageAgent: true, user: { roles: [] } });
    expect(hasAdd(p)).toBe(true);
    expect(p.textContent).not.toContain(ADMIN_ONLY);
  });
  it.each([[false], [null]])('a viewer the server does not let manage it (%s) is read-only and told only the owner can', async (flag) => {
    const p = await mountAi({ canManageAgent: flag, user: { roles: [] } });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(OWNER_ONLY);
  });
  it('a platform admin who is not the owner (effectiveAccess says manage, the gate refuses) is read-only', async () => {
    const p = await mountAi({ canManageAgent: true, user: { roles: ['ADMIN'] } });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(OWNER_ONLY);
  });
  it('an impersonated session is read-only even for the owner', async () => {
    const p = await mountAi({ canManageAgent: true, user: { roles: [] }, impersonating: 'Ada' });
    expect(hasAdd(p)).toBe(false);
  });
});

describe('an organization\'s Agent, AI tab (unchanged)', () => {
  const org = (role: string) => ({ id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com', members: [{ user: { id: 'user-1' }, role }] });
  it('an org ADMIN sees the controls whatever the flag says', async () => {
    const p = await mountAi({ org: org('ADMIN'), canManageAgent: null, user: { roles: [] } }, { organizationId: 'o1' });
    expect(hasAdd(p)).toBe(true);
  });
  it('a CONTRIBUTOR keeps the admin line', async () => {
    const p = await mountAi({ org: org('CONTRIBUTOR'), canManageAgent: true, user: { roles: [] } }, { organizationId: 'o1' });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(ADMIN_ONLY);
  });
});
