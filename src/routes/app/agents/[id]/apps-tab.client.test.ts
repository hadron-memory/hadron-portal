/** portal#472: the Apps tab is a shared DataTable with an org filter over the already-authorized installedApps. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const acme = { id: 'o-acme', name: 'Acme', urn: 'hrn:org:acme.com' };
const beta = { id: 'o-beta', name: 'Beta Co', urn: 'hrn:org:beta.com' };
const app = (n: number, orgId: string | null) => ({ id: `app-${n}`, name: `App ${String(n).padStart(2, '0')}`, urn: `hrn:app:x:app-${n}`, orgId });

async function mountApps(extra: Record<string, unknown>, agentId = 'a') {
  const data = await pageData(agentId, { mentionOnly: false });
  const props = reactiveProps<Record<string, unknown>>({ data: { ...data, navOrgs: [acme, beta], ...extra }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  openApps(m.target);
  return m;
}

function openApps(root: HTMLElement) {
  const tab = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Apps'));
  tab?.click();
  flushSync();
}

const rowNames = (root: HTMLElement) => [...root.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(label));

async function pickOrg(root: HTMLElement, name: string) {
  button(root, 'All organizations')?.click();
  flushSync();
  await tick();
  const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes(name));
  [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Select'))?.click();
  flushSync();
  await tick();
}

describe('agent Apps tab (#472)', () => {
  it('renders the mounted Apps tab as a table with Name, URN and Organization columns', async () => {
    const m = await mountApps({ installedApps: [app(1, acme.id), app(2, null)] });
    const heads = [...m.target.querySelectorAll('thead th')].map((h) => h.textContent ?? '');
    expect(heads.join('|')).toContain('Name');
    expect(heads.join('|')).toContain('URN');
    expect(heads.join('|')).toContain('Organization');
    const rows = rowNames(m.target);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('App 01');
    expect(rows[0].replace(/\s/g, '')).toContain('hrn:app:x:app-1');
    expect(rows[0]).toContain('Acme');
    expect(rows[1]).toContain('Personal');
    expect(m.target.querySelector('a[href="/app/apps/app-1"]')).not.toBeNull();
  });

  it('keeps an org the user cannot name distinct from a personal App', async () => {
    const m = await mountApps({ installedApps: [app(1, 'o-unknown'), app(2, null)] });
    const rows = rowNames(m.target);
    expect(rows[0]).toContain('Organization not visible to you');
    expect(rows[0]).not.toContain('Personal');
    expect(rows[1]).toContain('Personal');
  });

  it('pages beyond the first page', async () => {
    const m = await mountApps({ installedApps: Array.from({ length: 25 }, (_, i) => app(i + 1, acme.id)) });
    expect(rowNames(m.target)).toHaveLength(20);
    const next = [...m.target.querySelectorAll('button')].find((b) => /next/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    next?.click();
    flushSync();
    expect(rowNames(m.target)).toHaveLength(5);
  });

  it('filters by org, resets to page 1, and clears back to every App', async () => {
    const installed = [...Array.from({ length: 22 }, (_, i) => app(i + 1, acme.id)), app(30, beta.id), app(31, null)];
    const m = await mountApps({ installedApps: installed });
    const next = [...m.target.querySelectorAll('button')].find((b) => /next/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    next?.click();
    flushSync();
    expect(rowNames(m.target)).toHaveLength(4);
    await pickOrg(m.target, 'Beta Co');
    const rows = rowNames(m.target);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('App 30');
    button(m.target, 'Clear')?.click();
    flushSync();
    expect(rowNames(m.target)).toHaveLength(20);
  });

  it('offers only orgs that own one of this agent\'s Apps', async () => {
    const m = await mountApps({ installedApps: [app(1, acme.id)] });
    button(m.target, 'All organizations')?.click();
    flushSync();
    await tick();
    const dialogText = [...document.querySelectorAll('tbody tr')].map((r) => r.textContent).join('|');
    expect(dialogText).toContain('Acme');
    expect(dialogText).not.toContain('Beta Co');
  });

  it('drops a pick whose org left the data instead of showing an empty list', async () => {
    const m = await mountApps({ installedApps: [app(1, acme.id), app(2, beta.id)] });
    await pickOrg(m.target, 'Beta Co');
    expect(rowNames(m.target)).toHaveLength(1);
    m.props.data = { ...(m.props.data as object), installedApps: [app(1, acme.id)] };
    flushSync();
    await tick();
    expect(rowNames(m.target).join('|')).toContain('App 01');
  });

  it('does not carry the org filter to another agent', async () => {
    const m = await mountApps({ installedApps: [app(1, acme.id), app(2, beta.id)] }, 'a');
    await pickOrg(m.target, 'Beta Co');
    expect(rowNames(m.target)).toHaveLength(1);
    const next = await pageData('b', { mentionOnly: false });
    m.props.data = { ...next, navOrgs: [acme, beta], installedApps: [app(1, acme.id), app(2, beta.id)] };
    flushSync();
    await tick();
    openApps(m.target);
    expect(rowNames(m.target)).toHaveLength(2);
  });

  it('says an agent installed nowhere is installed nowhere, and a failed read is a failure', async () => {
    const none = await mountApps({ installedApps: [] });
    expect(none.target.textContent).toContain("isn't installed into any apps yet");
    const failed = await mountApps({ installedApps: [], installedAppsError: true });
    expect(failed.target.querySelector('[role="alert"]')?.textContent ?? '').toContain('could not be loaded');
    expect(failed.target.textContent).not.toContain("isn't installed into any apps yet");
  });

  it('keeps the rows and warns when only one of the two reads failed', async () => {
    const m = await mountApps({ installedApps: [app(1, acme.id)], installedAppsError: true });
    expect(rowNames(m.target)).toHaveLength(1);
    expect(m.target.querySelector('[role="alert"]')?.textContent ?? '').toContain('may be incomplete');
  });
});


it('#1408 Agent exposes its selected panel through the shared tab semantics', async () => {
  const { target } = await mountApps({ installedApps: [] });
  const selected = target.querySelector('[role="tab"][aria-selected="true"]');
  const panel = target.querySelector('[role="tabpanel"]');
  expect(selected).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(selected!.getAttribute('aria-controls')).toBe(panel!.id);
  expect(panel!.getAttribute('aria-labelledby')).toBe(selected!.id);
});
