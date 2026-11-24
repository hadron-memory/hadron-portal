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
import { appTypePageData } from '$lib/test/fixtures/app-type-page-data';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import pageSource from './+page.svelte?raw';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

async function mountTab(tab: 'profile' | 'settings', appType: string) {
  const data = await appTypePageData(tab, appType);
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  // Settings' sections start folded: the App section holds the Type row and the Edit button.
  if (tab === 'settings') {
    m.target.querySelector<HTMLButtonElement>('#section-app-toggle')!.click();
    await tick(2);
  }
  return m.target as HTMLElement;
}

// The attribute must follow whitespace: `\bvalue` also matched the tail of `data-value`.
const LITERAL_ENUM_OPTION = /<option\b[^>]*\svalue\s*=\s*['"]?(WORKSTATION|CHATBOT|AGENT|AUTOMATION|CLOUD|IOT)\b/;

describe('the App type shows its label (#2249)', () => {
  it('the Profile Type row shows the Settings option text, icon included', async () => {
    const target = await mountTab('profile', 'IOT');
    const row = target.querySelector<HTMLElement>('[data-testid="profile-type"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('📡 IoT');
  });

  it('the Settings read-only Type row shows the same text', async () => {
    const target = await mountTab('settings', 'IOT');
    const row = target.querySelector<HTMLElement>('[data-testid="settings-type"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('📡 IoT');
  });

  it('the Settings edit form options show the same labels', async () => {
    const target = await mountTab('settings', 'IOT');
    // editMode starts false; the read-only card's Edit button reveals the form.
    const edit = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Edit');
    expect(edit, 'the Settings card has no Edit button; was it renamed?').toBeDefined();
    edit!.click();
    await tick(2);
    const options = [...target.querySelectorAll<HTMLSelectElement>('#appType option')].map((o) => o.textContent);
    expect(options).toEqual(['💻 Workstation', '💬 Chatbot', '🤖 Agent', '⚙️ Automation', '☁️ Cloud', '📡 IoT']);
  });

  it('an unknown value from a newer server renders the raw value, never blank', async () => {
    const target = await mountTab('profile', 'FUTURE');
    const row = target.querySelector<HTMLElement>('[data-testid="profile-type"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toBe('FUTURE');
  });

  it('the Settings options are built from the shared source, not a hard-coded list', () => {
    // The options test above pins the rendered text, so re-hard-coding the
    // list in the page would still pass it; pin the source instead.
    expect(pageSource).toMatch(/import\s*\{[^}]*\bAPP_TYPE_VALUES\b[^}]*\}\s*from/);
    expect(pageSource).toMatch(/\{#each\s+APP_TYPE_VALUES\s+as\b/);
    // quote-agnostic: no <option> with a literal enum value, however it is quoted
    expect(pageSource).not.toMatch(LITERAL_ENUM_OPTION);
  });

  it('the literal-option guard catches a real value attribute but not data-value', () => {
    expect('<option value="IOT">').toMatch(LITERAL_ENUM_OPTION);
    expect("<option class=a value='IOT'>").toMatch(LITERAL_ENUM_OPTION);
    expect('<option data-value="IOT">').not.toMatch(LITERAL_ENUM_OPTION);
  });
});
