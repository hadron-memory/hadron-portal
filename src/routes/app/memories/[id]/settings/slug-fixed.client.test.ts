/** #2653 — a personal or private memory with an App keeps its slug: no slug input, display name still saves. */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import type { Memory } from '$lib/types';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetStubPage();
});

async function mountEdit(overrides: Partial<Memory>) {
  const graph = settingsGraph({ organizationId: null, userId: OWNER_ID, urn: 'hrn:mem:owner:mine', ...overrides });
  const forms = await settingsForms(graph);
  const props = reactiveProps<Record<string, unknown>>({
    data: { graph, user: OWNER, ownerUserId: OWNER_ID, owner: OWNER, org: null, allOrgs: [], canWriteMemory: true, canManageMemory: true, impersonation: null, roleConfigAvailable: true, transferCanDelete: false, ...forms } as never,
    form: null as never,
  });
  setStubPage('http://localhost/app/memories/mem-1/settings?edit=1', { id: 'mem-1' });
  page.update((current) => ({ ...current, data: props.data as Record<string, unknown> }));
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return mounted.target;
}
const slugInput = (t: HTMLElement) => t.querySelector('#urnSlugInput');
const presentFlag = (t: HTMLElement) => t.querySelector<HTMLInputElement>('input[name="urnSlugPresent"]');

describe('memory settings: the slug of an App personal or private memory', () => {
  it.each(['personal', 'private'] as const)('offers no slug input for a %s memory with an App, and still offers the name', async (cls) => {
    const t = await mountEdit({ class: cls, appId: 'app-1' });
    expect(t.querySelector('form#graph-settings')).not.toBeNull();
    expect(slugInput(t)).toBeNull();
    expect(presentFlag(t)).toBeNull();
    expect(t.querySelector('#displayName')).not.toBeNull();
    expect(t.textContent?.replace(/\s+/g, '')).toContain('hrn:mem:owner:mine');
    expect(t.textContent).toContain('keeps its address');
  });

  it.each([
    ['personal', null],
    ['private', undefined],
    ['knowledge', 'app-1'],
    ['group', 'app-1'],
  ] as const)('keeps the slug input for a %s memory with appId %s', async (cls, appId) => {
    const t = await mountEdit({ class: cls as never, appId, urn: 'hrn:mem:acme.com:docs' });
    expect(slugInput(t)).not.toBeNull();
    expect(presentFlag(t)?.value).toBe('true');
    expect(t.textContent).not.toContain('keeps its address');
  });
});
