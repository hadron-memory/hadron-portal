/**
 * portal#2249 — the App type renders as its label, not the raw enum.
 *
 * Red-first acceptance (the issue's list): the Profile tab's Type row and the
 * Settings read-only view's Type row both show exactly the Settings option
 * text, icon included ("📡 IoT" for IOT); an unknown value from a newer server
 * renders as the raw value, never blank. On main both rows render `IOT`, so
 * every test here is red there. The enum-coverage pin (a new z.enum value
 * without a label fails) lives beside the strings module in
 * src/lib/i18n/app-type-strings.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

async function mountTab(tab: 'profile' | 'settings', app: Record<string, unknown>) {
  const url = `/app/apps/a1?tab=${tab}`;
  setStubPage(`https://example.test${url}`, { appId: 'a1' });
  window.history.replaceState({}, '', url);
  const base = await pageData();
  const data = { ...base, app: { ...base.app, ...app }, initialTab: tab, canManageApp: true };
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target as HTMLElement;
}

describe('the App type shows its label (#2249)', () => {
  it('the Profile Type row shows the Settings option text, icon included', async () => {
    const target = await mountTab('profile', { appType: 'IOT' });
    const row = target.querySelector<HTMLElement>('[data-testid="profile-type"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('📡 IoT');
  });

  it('the Settings read-only Type row shows the same text', async () => {
    const target = await mountTab('settings', { appType: 'IOT' });
    const row = target.querySelector<HTMLElement>('[data-testid="settings-type"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('📡 IoT');
  });

  it('the Settings edit form options show the same labels', async () => {
    const target = await mountTab('settings', { appType: 'IOT' });
    // editMode starts false; the read-only card's Edit button reveals the form.
    const edit = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Edit');
    edit!.click();
    await tick(2);
    const options = [...target.querySelectorAll<HTMLSelectElement>('#appType option')].map((o) => o.textContent);
    expect(options).toEqual(['💻 Workstation', '💬 Chatbot', '🤖 Agent', '⚙️ Automation', '☁️ Cloud', '📡 IoT']);
  });

  it('an unknown value from a newer server renders the raw value, never blank', async () => {
    const target = await mountTab('profile', { appType: 'FUTURE' });
    const row = target.querySelector<HTMLElement>('[data-testid="profile-type"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('FUTURE');
  });
});
