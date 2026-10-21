/**
 * #1170: the agent detail page's header menu and profile card. Mounted, since
 * the menu opens by a click.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const org = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com', members: [], memories: [], agents: [], apps: [] };
const SYS_URN = 'hrn:mem:acme.com:agent-system';

async function open(agentOver: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const base = await pageData('a', { mentionOnly: false }, agentOver);
  const m = mountComponent(Page as never, { data: { ...base, ...extra }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m.target;
}

async function openMenu(root: HTMLElement) {
  (root.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).click();
  await tick();
  return [...root.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
}

describe('agent detail header menu (#1170)', () => {
  it('replaces the Install button with a menu: Install into app, Conversation editor, Open system memory', async () => {
    const root = await open({ organizationId: 'org-1', systemMemoryId: 'mem-sys' }, { org });
    // No bare Install button/link any more.
    expect([...root.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'Install')).toBe(false);
    const items = await openMenu(root);
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Install into app', 'Conversation editor', 'Open system memory']);
    expect(items.map((i) => i.getAttribute('href'))).toEqual([
      '/app/orgs/org-1/agents/install/a',
      '/app/agents/a/conversations',
      '/app/memories/mem-sys',
    ]);
  });

  it('a user-owned agent with no system memory has no menu at all', async () => {
    const root = await open({ organizationId: null, systemMemoryId: null });
    expect(root.querySelector('button[aria-haspopup="menu"]')).toBeNull();
  });

  it('an org agent without a system memory gets only Install into app', async () => {
    const root = await open({ organizationId: 'org-1', systemMemoryId: null }, { org });
    expect((await openMenu(root)).map((i) => i.textContent?.trim())).toEqual(['Install into app']);
  });
});

describe('agent detail profile card (#1170)', () => {
  it('no longer shows the system prompt or the Conversation Editor row', async () => {
    const root = await open({ systemPrompt: 'You are SECRET-PROMPT-TEXT', systemMemoryId: 'mem-sys' });
    expect(root.textContent).not.toContain('SECRET-PROMPT-TEXT');
    expect(root.textContent).not.toContain('Conversation Editor');
  });

  it('shows the system memory URN as a link to its resolver page', async () => {
    const root = await open(
      { systemMemoryId: 'mem-sys' },
      { systemMemoryIdentity: { id: 'mem-sys', name: 'Agent system', urn: SYS_URN } },
    );
    const link = root.querySelector(`a[href="/app/u/${SYS_URN}"]`);
    expect(link).not.toBeNull();
    expect(link!.querySelector(`[title="${SYS_URN}"]`)).not.toBeNull();
  });

  it('when the URN cannot be resolved, keeps the name link and invents no URN', async () => {
    const root = await open({ systemMemoryId: 'mem-sys' }, { systemMemoryIdentity: null });
    expect(root.querySelector('a[href="/app/memories/mem-sys"]')).not.toBeNull();
    expect(root.querySelector('a[href^="/app/u/"]')).toBeNull();
    expect(root.textContent).not.toMatch(/hrn:\s*mem:/);
  });
});
