import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import {
  navigationCalls,
  navigationHooks,
  resetNavigationCalls,
} from '$lib/test/stubs/app-navigation';
import AiServiceConfigSection from './AiServiceConfigSection.svelte';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
import type { AiServiceConfig } from '$lib/types';

type Props = Record<string, unknown>;
type Reply = { ok?: boolean; status?: number; body?: Record<string, unknown> | null };

const mounted: Array<Mounted<Props>> = [];
let posts: Array<Record<string, unknown>>;
let readbacks: string[];

function response(reply: Reply): Response {
  return {
    ok: reply.ok ?? true,
    status: reply.status ?? ((reply.ok ?? true) ? 200 : 400),
    json: async () => ('body' in reply ? reply.body : { ok: true }),
  } as Response;
}

function stubFetch(
  handler: (body: Record<string, unknown>) => Reply | Promise<Reply> = () => ({}),
  readback: (url: string) => Reply | Promise<Reply> = () => ({ body: { configs: [] } }),
) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/ai-configs?') && init?.method !== 'POST') {
      readbacks.push(url);
      return response(await readback(url));
    }
    if (url !== '/api/ai-configs' || init?.method !== 'POST') {
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    }
    const body = JSON.parse(init.body!) as Record<string, unknown>;
    posts.push(body);
    if (body.action === 'endpoints') return response({ body: { endpoints: [] } });
    return response(await handler(body));
  }));
}

beforeEach(() => {
  posts = [];
  readbacks = [];
  resetNavigationCalls();
  stubFetch();
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function config(over: Partial<AiServiceConfig> = {}): AiServiceConfig {
  return {
    id: 'c1', name: 'default', ownerType: 'ORGANIZATION', ownerId: 'o1', provider: 'glm', model: 'glm-5',
    endpoint: null, effectiveEndpoint: 'https://api.z.ai/api/paas/v4', apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS',
    hasApiKey: true, apiKeyPreview: '…abcd', params: null, enabled: true, createdAt: '2026-09-26T00:00:00Z', updatedAt: null,
    ...over,
  };
}

async function open(props: Props = {}, component = AiServiceConfigSection) {
  const m = mountComponent(component as never, reactiveProps({
    ownerType: 'ORGANIZATION', ownerId: 'o1', configs: [], canManage: true, allowTest: true,
    members: [{ user: { id: 'u1' }, role: 'ADMIN' }], currentUserId: 'u1',
    ...props,
  }) as never) as Mounted<Props>;
  mounted.push(m);
  await tick(2);
  return m;
}

const $ = <T extends Element = HTMLElement>(root: HTMLElement, sel: string) => root.querySelector<T & HTMLElement>(sel);
const feedback = (root: HTMLElement) => $<HTMLElement>(root, '[data-testid="ai-config-feedback"]')!;

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

function set(el: HTMLInputElement | HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  flushSync();
}

async function settle() {
  await tick(30);
  flushSync();
}

async function startCreate(root: HTMLElement, name = 'default') {
  button(root, 'Add configuration').click();
  await settle();
  set($<HTMLInputElement>(root, '#ac-name')!, name);
  set($<HTMLInputElement>(root, '#ac-model')!, 'glm-5');
  set($<HTMLInputElement>(root, '#ac-key')!, 'synthetic-key');
}

function editRow(root: HTMLElement, name = 'default'): void {
  const label = aiConfigStrings.actionsLabel(name);
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no actions trigger for "${name}"`);
  trigger.click();
  flushSync();
  const item = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((x) => x.textContent?.trim() === 'Edit');
  if (!item) throw new Error('no Edit menu item');
  item.click();
  flushSync();
}

function menuDelete(root: HTMLElement, name = 'default'): void {
  const label = aiConfigStrings.actionsLabel(name);
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no actions trigger for "${name}"`);
  trigger.click();
  flushSync();
  const item = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((x) => x.textContent?.trim() === 'Delete');
  if (!item) throw new Error('no Delete menu item');
  item.click();
  flushSync();
}

describe('AI configuration acknowledgement (#303)', () => {
  it('shows the caller-supplied owner, omits a null owner, and passes it through the section', async () => {
    const manager = await open({ ownerLabel: 'Acme' });
    expect(manager.target.textContent).toContain('AI provider configurations');
    expect(manager.target.textContent).toContain('Owned by Acme');

    const section = await open({
      ownerLabel: 'Acme', canManage: undefined,
      members: [{ user: { id: 'u1' }, role: 'ADMIN' }], currentUserId: 'u1',
    }, AiServiceConfigSection);
    expect(section.target.textContent).toContain('Owned by Acme');

    const withoutOwner = await open({ ownerLabel: null });
    expect(withoutOwner.target.textContent).not.toContain('Owned by');
  });

  it('titles an existing editor with the configuration name', async () => {
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    expect(target.querySelector('h3')?.textContent?.trim()).toBe('“default”');
  });

  it('acknowledges create in a persistent live region, refreshes, and does not navigate', async () => {
    const { target } = await open();
    const region = feedback(target);
    expect(region).not.toBeNull();
    expect(region.textContent?.trim()).toBe('');

    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(feedback(target)).toBe(region);
    expect(region.textContent).toContain('Saved “fast”.');
    expect(target.querySelector('#ac-name')).toBeNull();
    expect(readbacks).toEqual(['/api/ai-configs?ownerType=ORGANIZATION&ownerId=o1']);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(0);
  });

  it('acknowledges update and delete with the affected configuration name', async () => {
    stubFetch(() => ({}), () => ({ body: { configs: [config()] } }));
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    button(target, 'Save').click();
    await settle();
    expect(feedback(target).textContent).toContain('Saved “default”.');

    menuDelete(target);
    button(target, 'Delete').click();
    await settle();
    expect(feedback(target).textContent).toContain('Deleted “default”.');
    expect(posts.filter((p) => p.action === 'delete')).toEqual([{ action: 'delete', id: 'c1' }]);
  });

  it('keeps a refused save open with its draft, then clears the old error on a valid retry', async () => {
    stubFetch((body) => body.action === 'create' && posts.filter((p) => p.action === 'create').length === 1
      ? { ok: false, body: { error: 'Name already exists.' } }
      : {});
    const { target } = await open();
    await startCreate(target, 'fast');

    // Characterization control for the original stale-validation report.
    set($<HTMLInputElement>(target, '#ac-name')!, 'INVALID NAME');
    button(target, 'Save').click();
    await settle();
    expect(target.textContent).toContain(aiConfigStrings.invalidName());
    set($<HTMLInputElement>(target, '#ac-name')!, 'fast');

    button(target, 'Save').click();
    await settle();
    expect(target.textContent).toContain('Name already exists.');
    expect($<HTMLInputElement>(target, '#ac-name')!.value).toBe('fast');
    expect(feedback(target).textContent?.trim()).toBe('');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);

    button(target, 'Save').click();
    await settle();
    expect(target.textContent).not.toContain('Name already exists.');
    expect(feedback(target).textContent).toContain('Saved “fast”.');
  });

  it('reports a saved create whose refresh failed without calling it a save refusal', async () => {
    stubFetch(() => ({}), () => { throw new Error('synthetic refresh failure'); });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(feedback(target).textContent).toContain('Saved “fast”');
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(target.textContent).not.toContain('synthetic refresh failure');
    expect(target.textContent).not.toContain('Failed to save configuration');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('reports a committed delete whose refresh failed and offers readback, never a replay', async () => {
    stubFetch(() => ({}), () => { throw new Error('synthetic refresh failure'); });
    const { target } = await open({ configs: [config()] });
    menuDelete(target);
    button(target, 'Delete').click();
    await settle();

    expect(feedback(target).textContent).toContain('Deleted “default”');
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(posts.filter((p) => p.action === 'delete')).toHaveLength(1);
  });

  it('expires the acknowledgement but keeps the live region mounted', async () => {
    vi.useFakeTimers();
    const { target } = await open();
    const region = feedback(target);
    await startCreate(target);
    button(target, 'Save').click();
    await settle();
    expect(region.textContent).toContain('Saved “default”.');

    await vi.advanceTimersByTimeAsync(6000);
    flushSync();
    expect(feedback(target)).toBe(region);
    expect(region.textContent?.trim()).toBe('');
  });

  it('clears the acknowledgement on the next section action', async () => {
    const { target } = await open();
    const region = feedback(target);
    await startCreate(target);
    button(target, 'Save').click();
    await settle();
    expect(region.textContent).toContain('Saved “default”.');

    button(target, 'Add configuration').click();
    await settle();
    expect(feedback(target)).toBe(region);
    expect(region.textContent?.trim()).toBe('');
  });

  it('drops a late result after the owner changes, and accepts the same result at the same owner', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await held;
      return {};
    });
    const stale = await open({ ownerLabel: 'First' });
    await startCreate(stale.target, 'fast');
    button(stale.target, 'Save').click();
    await tick(2);

    stale.props.ownerId = 'o2';
    stale.props.ownerLabel = 'Second';
    await tick(3);
    release();
    await settle();
    expect(stale.target.textContent).toContain('Owned by Second');
    expect(feedback(stale.target).textContent?.trim()).toBe('');
    expect(stale.target.textContent).not.toContain('Saved “fast”.');

    // Positive control at the same lifecycle position: without an owner change,
    // this exact deferred path delivers the acknowledgement.
    let releaseFresh!: () => void;
    const freshHeld = new Promise<void>((resolve) => { releaseFresh = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await freshHeld;
      return {};
    });
    const fresh = await open();
    await startCreate(fresh.target, 'fast');
    button(fresh.target, 'Save').click();
    await tick(2);
    releaseFresh();
    await settle();
    expect(feedback(fresh.target).textContent).toContain('Saved “fast”.');
  });
});

describe('AI configuration feedback lifecycle review controls', () => {
  it('refreshes a committed save even when Cancel supersedes its feedback', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await held;
      return {};
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await tick(2);
    button(target, 'Cancel').click();
    release();
    await settle();

    expect(readbacks).toHaveLength(1);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(feedback(target).textContent?.trim()).toBe('');
  });

  it('keeps a committed outcome visible when the refreshed loader reports configsError', async () => {
    const m = await open();
    stubFetch(() => ({}), () => {
      m.props.configsError = true;
      return { body: { configs: [] } };
    });
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();

    expect(feedback(m.target).textContent).toContain('Saved “fast”');
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');
    expect(feedback(m.target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(m.target.textContent).toContain(aiConfigStrings.loadError());
  });

  it('treats a dropped mutation response as uncertain and offers readback before any retry', async () => {
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect($<HTMLInputElement>(target, '#ac-name')!.value).toBe('fast');
    expect(feedback(target).textContent).toContain('couldn’t confirm the change went through');
    expect(feedback(target).getAttribute('role')).toBe('status');
    expect(target.textContent).not.toContain('Failed to save configuration');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1);
  });

  it('treats a JSON 5xx mutation response as uncertain, not a definitive refusal', async () => {
    stubFetch((body) => body.action === 'create'
      ? { ok: false, status: 500, body: { error: 'Failed to create AI configuration.' } }
      : {});
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect($<HTMLInputElement>(target, '#ac-name')!.value).toBe('fast');
    expect(feedback(target).textContent).toContain('couldn’t confirm the change went through');
    expect(target.textContent).not.toContain('Failed to create AI configuration.');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('does not expire a refresh-failure warning or its reload control', async () => {
    vi.useFakeTimers();
    stubFetch(() => ({}), () => { throw new Error('refresh failed'); });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');

    await vi.advanceTimersByTimeAsync(6000);
    flushSync();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('clears a committed outcome on owner change even while configsError hides the manager', async () => {
    const m = await open({ ownerLabel: 'First' });
    stubFetch(() => ({}), () => {
      m.props.configsError = true;
      return { body: { configs: [] } };
    });
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(feedback(m.target).textContent).toContain('Saved “fast”');
    expect(m.target.textContent).toContain(aiConfigStrings.loadError());

    m.props.ownerId = 'o2';
    m.props.ownerLabel = 'Second';
    await settle();

    expect(feedback(m.target).textContent?.trim()).toBe('');
    expect(m.target.textContent).not.toContain('Saved “fast”');
  });

  it('preserves a connection-test transport error instead of generalizing it as a mutation failure', async () => {
    stubFetch(async (body) => {
      if (body.action === 'test') throw new Error('provider unreachable');
      return {};
    });
    const { target } = await open();
    await startCreate(target);
    button(target, 'Test').click();
    await settle();

    expect(target.textContent).toContain('provider unreachable');
    expect(target.textContent).not.toContain('Request failed');
    expect(target.textContent).not.toContain('couldn’t confirm the change went through');
  });

  it('keeps an uncertain mutation outcome visible after Cancel supersedes the editor', async () => {
    let rejectCreate!: (error: Error) => void;
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await tick(2);
    button(target, 'Cancel').click();
    rejectCreate(new Error('dropped response'));
    await settle();

    expect(target.querySelector('#ac-name')).toBeNull();
    expect(feedback(target).textContent).toContain('couldn’t confirm the change went through');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('keeps a committed refresh failure visible when a newer action supersedes ordinary success', async () => {
    let rejectRefresh!: (error: Error) => void;
    stubFetch(() => ({}), () => new Promise<never>((_, reject) => { rejectRefresh = reject; }));
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();
    button(target, 'Add configuration').click();
    rejectRefresh(new Error('refresh failed'));
    await settle();

    expect(feedback(target).textContent).not.toContain('Saved “fast”.');
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('acknowledges a committed save when refreshed permissions hide the manager', async () => {
    const m = await open();
    stubFetch(() => ({}), () => {
      m.props.members = [];
      return { body: { configs: [] } };
    });
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();

    expect(m.target.textContent).toContain(aiConfigStrings.adminOnly());
    expect(feedback(m.target).textContent).toContain('Saved “fast”.');
  });

  it('keeps the uncertainty readback control when another delete is armed', async () => {
    stubFetch(async (body) => {
      if (body.action === 'delete') throw new Error('dropped response');
      return {};
    });
    const second = config({ id: 'c2', name: 'fast' });
    const { target } = await open({ configs: [config(), second] });
    menuDelete(target, 'default');
    button(target, 'Delete').click();
    await settle();
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();

    menuDelete(target, 'fast');
    await settle();

    expect(feedback(target).textContent).toContain('couldn’t confirm the change went through');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(button(target, 'Delete').disabled).toBe(true);
    button(target, 'Delete').click();
    expect(posts.filter((p) => p.action === 'delete')).toHaveLength(1);
  });

  it.each([
    { label: 'an empty success envelope', body: {} },
    { label: 'an explicitly unsuccessful envelope', body: { ok: false } },
    { label: 'a null body', body: null },
  ])('treats $label as an unconfirmed mutation, never success', async ({ body: replyBody }) => {
    stubFetch((body) => body.action === 'create' ? { body: replyBody } : {});
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect($<HTMLInputElement>(target, '#ac-name')!.value).toBe('fast');
    expect(feedback(target).textContent).toContain('couldn’t confirm the change went through');
    expect(feedback(target).textContent).not.toContain('Saved “fast”.');
    expect(readbacks).toHaveLength(0);
  });

  it('locks the same mutation action after an uncertain outcome until readback', async () => {
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(button(target, 'Save').disabled).toBe(true);
    button(target, 'Save').click();
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1);
  });

  it('preserves the previous refresh behavior for a standalone manager', async () => {
    const { target } = await open({}, AiServiceConfigManager);
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
  });

  it('keeps the page and committed warning when the section-owned readback fails', async () => {
    stubFetch(() => ({}), () => { throw new Error('readback failed'); });
    const m = await open();
    navigationHooks.onInvalidateAll = () => {
      const index = mounted.indexOf(m);
      if (index >= 0) mounted.splice(index, 1);
      m.unmount(); // kit's real error boundary unmounts the caller, not a rejection
    };
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();

    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(readbacks).toHaveLength(1);
    expect(feedback(m.target).textContent).toContain('Saved “fast”');
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');
  });

  it('clears an earlier refresh-failure warning after a later successful readback', async () => {
    let first = true;
    navigationHooks.onInvalidateAll = () => {
      if (first) { first = false; throw new Error('refresh failed'); }
    };
    stubFetch(() => ({}), () => {
      if (first) { first = false; throw new Error('readback failed'); }
      return { body: { configs: [] } };
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');

    await startCreate(target, 'frontier');
    button(target, 'Save').click();
    await settle();

    expect(feedback(target).textContent).toContain('Saved “frontier”.');
    expect(feedback(target).textContent).not.toContain('couldn’t be refreshed');
  });

  it.each([
    { label: 'a failed-read envelope', body: { failed: true } },
    { label: 'a non-list payload', body: { configs: 'not-a-list' } },
    { label: 'a malformed config row', body: { configs: [{ ...config(), enabled: 'yes' }] } },
  ])('keeps the committed warning and page when readback returns $label', async ({ body }) => {
    stubFetch(() => ({}), () => ({ body }));
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(feedback(target).textContent).toContain('Saved “fast”');
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(button(target, 'Add configuration')).not.toBeNull();
  });

  it('lets a later loader replacement supersede the section working copy', async () => {
    const fresh = config({ id: 'c2', name: 'fast' });
    stubFetch(() => ({}), () => ({ body: { configs: [fresh] } }));
    const m = await open({ configs: [config()] });
    editRow(m.target);
    button(m.target, 'Save').click();
    await settle();
    expect(m.target.textContent).toContain('fast');

    m.props.configs = [config({ id: 'c3', name: 'frontier' })];
    await settle();
    expect(m.target.textContent).toContain('frontier');
    expect(m.target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('fast')}"]`)).toBeNull();
  });

  it('discards a readback issued for the old owner and applies its own-owner counterpart', async () => {
    let release!: (reply: Reply) => void;
    const held = new Promise<Reply>((resolve) => { release = resolve; });
    stubFetch(() => ({}), () => held);
    const stale = await open({ configs: [config()] });
    editRow(stale.target);
    button(stale.target, 'Save').click();
    await settle();

    stale.props.ownerId = 'o2';
    stale.props.configs = [config({ id: 'other', ownerId: 'o2', name: 'frontier' })];
    await settle();
    release({ body: { configs: [config({ id: 'c2', name: 'fast' })] } });
    await settle();

    expect(stale.target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('frontier')}"]`)).not.toBeNull();
    expect(stale.target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('fast')}"]`)).toBeNull();
    expect(feedback(stale.target).textContent?.trim()).toBe('');

    let releaseFresh!: (reply: Reply) => void;
    const freshHeld = new Promise<Reply>((resolve) => { releaseFresh = resolve; });
    stubFetch(() => ({}), () => freshHeld);
    const fresh = await open({ configs: [config()] });
    editRow(fresh.target);
    button(fresh.target, 'Save').click();
    await settle();
    releaseFresh({ body: { configs: [config({ id: 'c2', name: 'fast' })] } });
    await settle();

    expect(fresh.target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('fast')}"]`)).not.toBeNull();
    expect(feedback(fresh.target).textContent).toContain('Saved “default”.');
  });

  it('does not let a late old-owner uncertainty lock the current owner', async () => {
    let rejectCreate!: (error: Error) => void;
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.ownerId = 'o2';
    await settle();
    rejectCreate(new Error('dropped response'));
    await settle();

    expect(feedback(m.target).textContent?.trim()).toBe('');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
  });

  it('shows standalone uncertainty with readback instead of a silent replay lock', async () => {
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const { target } = await open({}, AiServiceConfigManager);
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    const region = $<HTMLElement>(target, '[data-testid="ai-config-manager-feedback"]')!;
    expect(region.textContent).toContain('couldn’t confirm the change went through');
    expect(region.querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(button(target, 'Save').disabled).toBe(true);
  });

  it('reports a standalone committed refresh rejection instead of dropping it', async () => {
    navigationHooks.onInvalidateAll = () => { throw new Error('refresh rejected'); };
    const { target } = await open({}, AiServiceConfigManager);
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    const region = $<HTMLElement>(target, '[data-testid="ai-config-manager-feedback"]')!;
    expect(region.textContent).toContain('Saved “fast”, but the configurations couldn’t be refreshed');
    expect(region.querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(button(target, 'Add configuration')).not.toBeNull();
  });

  it.each([
    { label: 'an older failure cannot overwrite a newer success', newerFails: false, olderFails: true, warning: false },
    { label: 'an older success cannot clear a newer failure', newerFails: true, olderFails: false, warning: true },
  ])('sequences standalone refreshes: $label', async ({ newerFails, olderFails, warning }) => {
    const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    navigationHooks.onInvalidateAll = () => new Promise<void>((resolve, reject) => {
      pending.push({ resolve: () => resolve(), reject });
    });
    const { target } = await open({}, AiServiceConfigManager);
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();
    await startCreate(target, 'frontier');
    button(target, 'Save').click();
    await settle();
    expect(pending).toHaveLength(2);

    if (newerFails) pending[1].reject(new Error('newer refresh failed'));
    else pending[1].resolve();
    await settle();
    if (olderFails) pending[0].reject(new Error('older refresh failed'));
    else pending[0].resolve();
    await settle();

    const region = $<HTMLElement>(target, '[data-testid="ai-config-manager-feedback"]')!;
    expect(region.textContent?.includes('couldn’t be refreshed')).toBe(warning);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(2);
  });

  it('acknowledges immediately and bounds a hung section readback', async () => {
    vi.useFakeTimers();
    stubFetch(() => ({}), () => new Promise<Reply>(() => {}));
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(feedback(target).textContent).toContain('Saved “fast”.');
    expect(feedback(target).textContent).not.toContain('couldn’t be refreshed');
    button(target, 'Add configuration').click();
    await settle();
    expect(button(target, 'Save').disabled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('reports failure of a caller-owned related readback without delaying success', async () => {
    const onRefreshed = vi.fn(() => false);
    const { target } = await open({ onRefreshed });
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(feedback(target).textContent).toContain('Saved “fast”');
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
  });

  it('lets inline delete Cancel supersede ordinary acknowledgement without cancelling readback', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'delete') await held;
      return {};
    });
    const { target } = await open({ configs: [config()] });
    menuDelete(target);
    button(target, 'Delete').click();
    await tick(2);
    button(target, 'Cancel').click();
    release();
    await settle();

    expect(feedback(target).textContent).not.toContain('Deleted “default”.');
    expect(readbacks).toHaveLength(1);
  });
});

describe('AI configuration review fix pins', () => {
  it('keeps Cancel → reopen → Save from overlapping a pending mutation', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await held;
      return {};
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await tick(2);

    button(target, 'Cancel').click();
    await settle();
    button(target, 'Add configuration').click();
    await settle();
    expect(button(target, 'Save').disabled).toBe(true);
    button(target, 'Save').click();
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1);

    release();
    await settle();
    expect(button(target, 'Save').disabled).toBe(false);
    set($<HTMLInputElement>(target, '#ac-name')!, 'frontier');
    set($<HTMLInputElement>(target, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(target, '#ac-key')!, 'another-synthetic-key');
    button(target, 'Save').click();
    await settle();
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(2);
  });

  it('applies the owner readback independently and bounds a hung related refresh', async () => {
    vi.useFakeTimers();
    const fresh = config({ id: 'c2', name: 'fast' });
    stubFetch(() => ({}), () => ({ body: { configs: [fresh] } }));
    const onRefreshed = vi.fn(() => new Promise<boolean>(() => {}));
    const { target } = await open({ onRefreshed });
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('fast')}"]`)).not.toBeNull();
    expect(feedback(target).textContent).not.toContain('couldn’t be refreshed');

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
  });

  it('drops an uncertain result from an earlier A visit after A → B → A', async () => {
    let rejectCreate!: (error: Error) => void;
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.ownerId = 'o2';
    await settle();
    m.props.ownerId = 'o1';
    await settle();
    rejectCreate(new Error('dropped response'));
    await settle();

    expect(feedback(m.target).textContent?.trim()).toBe('');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
  });

  it('drops a committed result from an earlier A visit after A → B → A', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await held;
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.ownerId = 'o2';
    await settle();
    m.props.ownerId = 'o1';
    await settle();
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    release();
    await settle();

    expect(readbacks).toHaveLength(0);
    expect(feedback(m.target).textContent?.trim()).toBe('');
    expect(button(m.target, 'Save').disabled).toBe(false);
  });

  it('announces a refused save through a persistent alert region', async () => {
    stubFetch((body) => body.action === 'create' ? { ok: false, body: { error: 'Name already exists.' } } : {});
    const { target } = await open();
    const region = $<HTMLElement>(target, '[data-testid="ai-config-error-feedback"]')!;
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.textContent?.trim()).toBe('');

    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect($<HTMLElement>(target, '[data-testid="ai-config-error-feedback"]')).toBe(region);
    expect(region.textContent).toContain('Name already exists.');
    expect($<HTMLInputElement>(target, '#ac-name')!.value).toBe('fast');
  });

  it('announces a refused delete through the same persistent alert region', async () => {
    stubFetch((body) => body.action === 'delete' ? { ok: false, body: { error: 'Delete refused.' } } : {});
    const { target } = await open({ configs: [config()] });
    const region = $<HTMLElement>(target, '[data-testid="ai-config-error-feedback"]')!;
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.textContent?.trim()).toBe('');

    menuDelete(target);
    button(target, 'Delete').click();
    await settle();

    expect($<HTMLElement>(target, '[data-testid="ai-config-error-feedback"]')).toBe(region);
    expect(region.textContent).toContain('Delete refused.');
    expect(button(target, 'Delete').disabled).toBe(false);
  });

  it('keeps a late refusal from an old Save out of a Cancel → New draft', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') {
        await held;
        return { ok: false, body: { error: 'Old refusal.' } };
      }
      return {};
    });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await tick(2);

    button(target, 'Cancel').click();
    await settle();
    button(target, 'Add configuration').click();
    await settle();
    set($<HTMLInputElement>(target, '#ac-name')!, 'frontier');
    set($<HTMLInputElement>(target, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(target, '#ac-key')!, 'new-synthetic-key');
    release();
    await settle();

    expect(target.textContent).not.toContain('Old refusal.');
    expect($<HTMLInputElement>(target, '#ac-name')!.value).toBe('frontier');
    expect($<HTMLElement>(target, '[data-testid="ai-config-error-feedback"]')!.textContent?.trim()).toBe('');
    expect(button(target, 'Save').disabled).toBe(false);
  });
});
