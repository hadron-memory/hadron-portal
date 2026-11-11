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
import { managerCallbacks } from '$lib/test/ai-config-manager';
import { resetAiConfigRecoveryForTests } from './ai-config-recovery';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
import type { AiServiceConfig } from '$lib/types';

type Props = Record<string, unknown>;
type Reply = { ok?: boolean; status?: number; body?: Record<string, unknown> | null };

const mounted: Array<Mounted<Props>> = [];
let posts: Array<Record<string, unknown>>;
let readbacks: string[];
let readbackSignals: Array<AbortSignal | undefined>;

function response(reply: Reply): Response {
  return {
    ok: reply.ok ?? true,
    status: reply.status ?? ((reply.ok ?? true) ? 200 : 400),
    json: async () => ('body' in reply ? reply.body : { ok: true }),
  } as Response;
}

function stubFetch(
  handler: (body: Record<string, unknown>, signal?: AbortSignal) => Reply | Promise<Reply> = () => ({}),
  readback: (url: string, signal?: AbortSignal) => Reply | Promise<Reply> = () => ({ body: { configs: [] } }),
) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
    if (url.startsWith('/api/ai-configs?') && init?.method !== 'POST') {
      readbacks.push(url);
      readbackSignals.push(init?.signal);
      return response(await readback(url, init?.signal));
    }
    if (url !== '/api/ai-configs' || init?.method !== 'POST') {
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    }
    const body = JSON.parse(init.body!) as Record<string, unknown>;
    posts.push(body);
    if (body.action === 'endpoints') return response({ body: { endpoints: [] } });
    return response(await handler(body, init?.signal));
  }));
}

beforeEach(() => {
  resetAiConfigRecoveryForTests();
  posts = [];
  readbacks = [];
  readbackSignals = [];
  resetNavigationCalls();
  stubFetch();
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  window.history.replaceState({}, '', '/');
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

async function open(props: Props = {}, component: unknown = AiServiceConfigSection) {
  const m = mountComponent(component as never, reactiveProps({
    ...managerCallbacks(),
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
  await tick(60);
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
    const manager = await open({ ownerLabel: 'Acme', ownerUrn: 'hrn:org:acme.com' });
    expect(manager.target.textContent).toContain('AI provider configurations');
    expect(manager.target.textContent).toContain('Owned by Acme');
    expect(manager.target.querySelector('[title="hrn:org:acme.com"]')).not.toBeNull();

    const section = await open({
      ownerLabel: 'Acme', ownerUrn: 'hrn:org:acme.com', canManage: undefined,
      members: [{ user: { id: 'u1' }, role: 'ADMIN' }], currentUserId: 'u1',
    }, AiServiceConfigSection);
    expect(section.target.textContent).toContain('Owned by Acme');
    expect(section.target.querySelector('[title="hrn:org:acme.com"]')).not.toBeNull();

    const withoutOwner = await open({ ownerLabel: null });
    expect(withoutOwner.target.textContent).not.toContain('Owned by');
    expect(withoutOwner.target.querySelector('[title="hrn:org:acme.com"]')).toBeNull();
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

  it('closes the editor when its open configuration is deleted through the row menu', async () => {
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    expect(target.querySelector('#ac-name')).not.toBeNull();

    menuDelete(target);
    button(target, 'Delete').click();
    await settle();

    expect(feedback(target).textContent).toContain('Deleted “default”.');
    expect(target.querySelector('#ac-name')).toBeNull();
    expect(posts.filter((p) => p.action === 'delete')).toEqual([{ action: 'delete', id: 'c1' }]);
    expect(posts.filter((p) => p.action === 'update')).toEqual([]);
  });

  it('closes a deleted row’s open editor even after the confirmation is cancelled in flight', async () => {
    let releaseDelete!: (reply: Reply) => void;
    stubFetch((body) => {
      if (body.action === 'delete') return new Promise<Reply>((resolve) => { releaseDelete = resolve; });
      return {};
    });
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    menuDelete(target);
    button(target, 'Delete').click();
    await tick(2);

    const question = [...target.querySelectorAll<HTMLSpanElement>('span')]
      .find((el) => el.textContent?.trim() === aiConfigStrings.confirmDelete('default'))!;
    const cancel = [...question.parentElement!.querySelectorAll<HTMLButtonElement>('button')]
      .find((el) => el.textContent?.trim() === 'Cancel')!;
    cancel.click();
    await tick(2);
    expect(target.querySelector('#ac-name')).not.toBeNull();
    releaseDelete({});
    await settle();

    expect(target.querySelector('#ac-name')).toBeNull();
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

  it('bounds a hung connection Test and aborts its request', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    stubFetch(async (body, signal) => {
      if (body.action === 'test') {
        requestSignal = signal;
        await new Promise<void>(() => {});
      }
      return {};
    });
    const { target } = await open();
    await startCreate(target);
    button(target, 'Test').click();
    await tick(2);

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(requestSignal?.aborted).toBe(true);
    expect(target.textContent).toContain('The test timed out. Try again.');
    expect(target.textContent).not.toContain('couldn’t confirm the change went through');
    expect(button(target, 'Save').disabled).toBe(false);
  });

  it('cancels the underlying saved-config Test when the editor closes', async () => {
    let requestSignal: AbortSignal | undefined;
    stubFetch(async (body, signal) => {
      if (body.action === 'testSaved') {
        requestSignal = signal;
        await new Promise<void>(() => {});
      }
      return {};
    });
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    button(target, 'Test').click();
    await tick(2);

    button(target, 'Cancel').click();
    await settle();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('aborts a saved-config Test when the owner changes', async () => {
    let requestSignal: AbortSignal | undefined;
    stubFetch(async (body, signal) => {
      if (body.action === 'testSaved') {
        requestSignal = signal;
        await new Promise<void>(() => {});
      }
      return {};
    });
    const m = await open({ configs: [config()] });
    editRow(m.target);
    await settle();
    button(m.target, 'Test').click();
    await tick(2);

    m.props.ownerId = 'o2';
    await settle();
    expect(requestSignal?.aborted).toBe(true);
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

  it('locks replay after a committed refresh failure leaves stale rows', async () => {
    stubFetch(() => ({}), () => { throw new Error('readback failed'); });
    const { target } = await open();
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');

    await startCreate(target, 'frontier');
    expect(button(target, 'Save').disabled).toBe(true);
    button(target, 'Save').click();
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1);
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
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
    const fresh = await open({
      configs: [config()],
      currentUserId: 'u2',
      members: [{ user: { id: 'u2' }, role: 'ADMIN' }],
    });
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
    expect(button(target, 'Save').disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
  });

  it('aborts a pending owner readback when the owner changes', async () => {
    stubFetch(() => ({}), () => new Promise<Reply>(() => {}));
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(readbackSignals[0]?.aborted).toBe(false);

    m.props.ownerId = 'o2';
    await settle();
    expect(readbackSignals[0]?.aborted).toBe(true);
  });

  it('aborts a pending owner readback when the user changes', async () => {
    stubFetch(() => ({}), () => new Promise<Reply>(() => {}));
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(readbackSignals[0]?.aborted).toBe(false);

    m.props.currentUserId = 'u2';
    m.props.members = [{ user: { id: 'u2' }, role: 'ADMIN' }];
    await settle();
    expect(readbackSignals[0]?.aborted).toBe(true);
  });

  it('aborts a pending owner readback on Section teardown', async () => {
    stubFetch(() => ({}), () => new Promise<Reply>(() => {}));
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(readbackSignals[0]?.aborted).toBe(false);

    mounted.splice(mounted.indexOf(m), 1);
    m.unmount();
    expect(readbackSignals[0]?.aborted).toBe(true);
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
    let relatedSignal: AbortSignal | undefined;
    const onRefreshed = vi.fn((signal?: AbortSignal) => {
      relatedSignal = signal;
      return new Promise<boolean>(() => {});
    });
    const { target } = await open({ onRefreshed });
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    expect(target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('fast')}"]`)).not.toBeNull();
    expect(feedback(target).textContent).not.toContain('couldn’t be refreshed');

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(relatedSignal?.aborted).toBe(true);
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
  });

  it('holds replay while reconciling an uncertain result from an earlier A visit', async () => {
    let rejectCreate!: (error: Error) => void;
    let releaseReadback!: (reply: Reply) => void;
    const readbackHeld = new Promise<Reply>((resolve) => { releaseReadback = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    }, () => readbackHeld);
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

    expect(readbacks).toHaveLength(1);
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);

    releaseReadback({ body: { configs: [] } });
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
    expect(button(m.target, 'Save').disabled).toBe(true);
  });

  it('reconciles a committed result from an earlier A visit after A → B → A', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await held;
      return {};
    }, () => ({ body: { configs: [config({ id: 'c2', name: 'fast' })] } }));
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.ownerId = 'o2';
    await settle();
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
    m.props.ownerId = 'o1';
    await settle();
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    release();
    await settle();

    expect(readbacks).toHaveLength(1);
    expect(m.target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('fast')}"]`)).not.toBeNull();
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

describe('AI configuration code-review lifecycle pins', () => {
  it('keeps the pending lock when configsError tears down and remounts the Manager', async () => {
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

    m.props.configsError = true;
    await settle();
    expect(m.target.textContent).toContain(aiConfigStrings.loadError());
    m.props.configsError = false;
    await settle();
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);

    release();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
  });

  it('preserves a Section success acknowledgement across Manager teardown and remount', async () => {
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(feedback(m.target).textContent).toContain('Saved “fast”.');

    m.props.configsError = true;
    await settle();
    m.props.configsError = false;
    await settle();

    expect(feedback(m.target).textContent).toContain('Saved “fast”.');
  });

  it('does not re-defer an old Section readback after its replacement recovered the outcome', async () => {
    const releases: Array<(reply: Reply) => void> = [];
    stubFetch(() => ({}), () => new Promise<Reply>((resolve) => { releases.push(resolve); }));
    const first = await open();
    await startCreate(first.target, 'fast');
    button(first.target, 'Save').click();
    await settle();
    expect(releases).toHaveLength(1);
    mounted.splice(mounted.indexOf(first), 1);
    first.unmount();

    const second = await open();
    await settle();
    expect(releases).toHaveLength(2);
    releases[1]({ body: { configs: [] } });
    await settle();
    expect(feedback(second.target).textContent).not.toContain('couldn’t be refreshed');

    // The destroyed Section's readback settles only after its replacement has
    // completed recovery. It must not enqueue the same outcome for a third run.
    releases[0]({ body: { configs: [] } });
    await settle();
    expect(releases).toHaveLength(2);
    expect(readbacks).toHaveLength(2);
    expect(feedback(second.target).textContent).not.toContain('couldn’t be refreshed');
  });

  it('turns a hung mutation POST into a visible uncertain outcome instead of a silent permanent lock', async () => {
    vi.useFakeTimers();
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<void>(() => {});
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

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(feedback(target).textContent).toContain('couldn’t confirm the change went through');
    expect(feedback(target).querySelector('a[data-sveltekit-reload]')).not.toBeNull();
    expect(button(target, 'Save').disabled).toBe(true);
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1);
  });

  it('keeps the timeout warning and replay lock when a related refresh later succeeds', async () => {
    vi.useFakeTimers();
    let releaseRelated!: (fresh: boolean) => void;
    const related = new Promise<boolean>((resolve) => { releaseRelated = resolve; });
    const { target } = await open({ onRefreshed: () => related });
    await startCreate(target, 'fast');
    button(target, 'Save').click();
    await settle();

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');

    releaseRelated(true);
    await settle();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');
    button(target, 'Add configuration').click();
    await settle();
    expect(button(target, 'Save').disabled).toBe(true);
  });

  it('uses the action-start owner identity for payload, pending registration and outcome', async () => {
    stubFetch(() => ({}));
    const m = await open();
    await startCreate(m.target, 'fast');

    // Change the props and click before the owner synchronization effect runs.
    m.props.ownerId = 'o2';
    button(m.target, 'Save').click();
    await settle();

    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1);
    expect(posts.find((p) => p.action === 'create')).toMatchObject({
      ownerType: 'ORGANIZATION', ownerId: 'o1',
    });
    expect(feedback(m.target).textContent?.trim()).toBe('');
  });

  it('remembers a committed A outcome that settles while B is selected', async () => {
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
    release();
    await settle();
    expect(readbacks).toHaveLength(0);

    m.props.ownerId = 'o1';
    await settle();
    expect(readbacks).toHaveLength(1);
    expect(feedback(m.target).textContent?.trim()).toBe('');
  });

  it('remembers an uncertain A outcome that settles while B is selected', async () => {
    let rejectCreate!: (error: Error) => void;
    let releaseReadback!: (reply: Reply) => void;
    const readbackHeld = new Promise<Reply>((resolve) => { releaseReadback = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    }, () => readbackHeld);
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.ownerId = 'o2';
    await settle();
    rejectCreate(new Error('dropped response'));
    await settle();
    expect(readbacks).toHaveLength(0);

    m.props.ownerId = 'o1';
    await settle();
    expect(readbacks).toHaveLength(1);
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');

    releaseReadback({ body: { configs: [] } });
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
  });

  it('restarts uncertain reconciliation when its readback crosses A → B → A', async () => {
    let rejectCreate!: (error: Error) => void;
    const releases: Array<(reply: Reply) => void> = [];
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    }, () => new Promise<Reply>((resolve) => { releases.push(resolve); }));
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
    expect(readbacks).toHaveLength(1);

    m.props.ownerId = 'o2';
    await settle();
    m.props.ownerId = 'o1';
    await settle();
    releases[0]({ body: { configs: [] } });
    await settle();
    expect(readbacks).toHaveLength(2);
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);

    m.props.ownerId = 'o2';
    await settle();
    m.props.ownerId = 'o1';
    await settle();
    releases[1]({ body: { configs: [] } });
    await settle();
    expect(readbacks).toHaveLength(3);
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);

    releases[2]({ body: { configs: [] } });
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
  });

  it('does not open a stale row for editing while its committed update readback is pending', async () => {
    let releaseReadback!: (reply: Reply) => void;
    const fresh = config({ model: 'glm-6' });
    stubFetch(() => ({}), () => new Promise<Reply>((resolve) => { releaseReadback = resolve; }));
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    set($<HTMLInputElement>(target, '#ac-model')!, 'glm-6');
    button(target, 'Save').click();
    await settle();

    editRow(target);
    await settle();
    expect(target.querySelector('#ac-name')).toBeNull();

    releaseReadback({ body: { configs: [fresh] } });
    await settle();
    editRow(target);
    await settle();
    expect($<HTMLInputElement>(target, '#ac-model')!.value).toBe('glm-6');
    expect(button(target, 'Save').disabled).toBe(false);
  });

  it('retains pending and uncertain outcomes across Section destroy and remount', async () => {
    let rejectCreate!: (error: Error) => void;
    let releaseReadback!: (reply: Reply) => void;
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    }, () => new Promise<Reply>((resolve) => { releaseReadback = resolve; }));
    const first = await open();
    await startCreate(first.target, 'fast');
    button(first.target, 'Save').click();
    await tick(2);
    mounted.splice(mounted.indexOf(first), 1);
    first.unmount();

    const second = await open();
    button(second.target, 'Add configuration').click();
    await settle();
    expect(button(second.target, 'Save').disabled).toBe(true);
    rejectCreate(new Error('dropped response'));
    await settle();
    expect(readbacks).toHaveLength(1);
    expect(button(second.target, 'Save').disabled).toBe(true);

    releaseReadback({ body: { configs: [] } });
    await settle();
    expect(button(second.target, 'Save').disabled).toBe(true);
    expect(feedback(second.target).textContent).toContain('couldn’t confirm the change went through');
  });

  it('keeps uncertainty after a late related success because the write may still commit', async () => {
    vi.useFakeTimers();
    let rejectCreate!: (error: Error) => void;
    let releaseRelated!: (fresh: boolean) => void;
    const related = new Promise<boolean>((resolve) => { releaseRelated = resolve; });
    stubFetch(async (body) => {
      if (body.action === 'create') await new Promise<never>((_, reject) => { rejectCreate = reject; });
      return {};
    });
    const m = await open({ onRefreshed: () => related });
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);
    m.props.ownerId = 'o2';
    await settle();
    m.props.ownerId = 'o1';
    await settle();
    rejectCreate(new Error('dropped response'));
    await settle();

    await vi.advanceTimersByTimeAsync(10_000);
    flushSync();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);

    releaseRelated(true);
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
    expect(button(m.target, 'Save').disabled).toBe(true);
  });

  it('retains a direct uncertain warning and replay lock across Section remount', async () => {
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const first = await open();
    await startCreate(first.target, 'fast');
    button(first.target, 'Save').click();
    await settle();
    expect(feedback(first.target).textContent).toContain('couldn’t confirm the change went through');
    mounted.splice(mounted.indexOf(first), 1);
    first.unmount();

    const second = await open();
    expect(feedback(second.target).textContent).toContain('couldn’t confirm the change went through');
    button(second.target, 'Add configuration').click();
    await settle();
    expect(button(second.target, 'Save').disabled).toBe(true);
  });

  it('keeps a stale row closed after its committed readback fails', async () => {
    stubFetch(() => ({}), () => { throw new Error('readback failed'); });
    const { target } = await open({ configs: [config()] });
    editRow(target);
    await settle();
    set($<HTMLInputElement>(target, '#ac-model')!, 'glm-6');
    button(target, 'Save').click();
    await settle();
    expect(feedback(target).textContent).toContain('couldn’t be refreshed');

    editRow(target);
    await settle();
    expect(target.querySelector('#ac-name')).toBeNull();
  });

  it('settles a mutation into the user store that registered it', async () => {
    let releaseCreate!: () => void;
    const createHeld = new Promise<void>((resolve) => { releaseCreate = resolve; });
    let releaseReadback!: (reply: Reply) => void;
    stubFetch(async (body) => {
      if (body.action === 'create') await createHeld;
      return {};
    }, () => new Promise<Reply>((resolve) => { releaseReadback = resolve; }));
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.currentUserId = 'u2';
    m.props.members = [{ user: { id: 'u2' }, role: 'ADMIN' }];
    await settle();
    releaseCreate();
    await settle();
    expect(readbacks).toHaveLength(0);
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
    button(m.target, 'Cancel').click();
    await settle();

    m.props.currentUserId = 'u1';
    m.props.members = [{ user: { id: 'u1' }, role: 'ADMIN' }];
    await settle();
    expect(readbacks).toHaveLength(1);
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    releaseReadback({ body: { configs: [] } });
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
  });

  it('keeps replay locked when a loader replacement prevents the owner readback from applying', async () => {
    let releaseReadback!: (reply: Reply) => void;
    const stale = config();
    const fresh = config({ model: 'glm-6' });
    stubFetch(() => ({}), () => new Promise<Reply>((resolve) => { releaseReadback = resolve; }));
    const m = await open({ configs: [stale] });
    editRow(m.target);
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-6');
    button(m.target, 'Save').click();
    await settle();
    expect(readbacks).toHaveLength(1);

    // An older loader completion wins the props race. The endpoint's fresh
    // rows must not be treated as applied while their identity token is stale.
    m.props.configs = [{ ...stale }];
    await settle();
    releaseReadback({ body: { configs: [fresh] } });
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');
    editRow(m.target);
    await settle();
    expect(m.target.querySelector('#ac-name')).toBeNull();
  });

  it('does not let an old user settlement clear a same-numbered new-user pending lock', async () => {
    const creates: Array<(reply: Reply) => void> = [];
    stubFetch((body) => {
      if (body.action === 'create') return new Promise<Reply>((resolve) => { creates.push(resolve); });
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'first');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.currentUserId = 'u2';
    m.props.members = [{ user: { id: 'u2' }, role: 'ADMIN' }];
    m.props.configsError = true;
    await settle();
    m.props.configsError = false;
    await settle();
    await startCreate(m.target, 'second');
    button(m.target, 'Save').click();
    await tick(2);
    expect(creates).toHaveLength(2);

    // Both Manager instances used mutation ID 1. The old user's refusal must
    // not unregister the new user's request from the shared recovery store.
    creates[0]({ ok: false, body: { error: 'old user refusal' } });
    await settle();
    m.props.configsError = true;
    await settle();
    m.props.configsError = false;
    await settle();
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);

    creates[1]({});
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
  });

  it('retains a committed readback warning and replay lock across an owner round-trip', async () => {
    stubFetch(() => ({}), () => { throw new Error('readback failed'); });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');

    m.props.ownerId = 'o2';
    await settle();
    expect(feedback(m.target).textContent).not.toContain('couldn’t be refreshed');
    m.props.ownerId = 'o1';
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
  });

  it('isolates a committed readback warning by user as well as owner', async () => {
    stubFetch(() => ({}), () => { throw new Error('readback failed'); });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');

    m.props.currentUserId = 'u2';
    m.props.members = [{ user: { id: 'u2' }, role: 'ADMIN' }];
    await settle();
    expect(feedback(m.target).textContent).not.toContain('couldn’t be refreshed');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);

    m.props.currentUserId = 'u1';
    m.props.members = [{ user: { id: 'u1' }, role: 'ADMIN' }];
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
  });

  it('rechecks the owner loader generation after the related refresh settles', async () => {
    let releaseRelated!: (fresh: boolean) => void;
    const related = vi.fn(() => new Promise<boolean>((resolve) => { releaseRelated = resolve; }));
    const stale = config();
    const fresh = config({ model: 'glm-6' });
    stubFetch(() => ({}), () => ({ body: { configs: [fresh] } }));
    const m = await open({ configs: [stale], onRefreshed: related });
    editRow(m.target);
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-6');
    button(m.target, 'Save').click();
    await settle();
    expect(readbacks).toHaveLength(1);
    expect(related).toHaveBeenCalledTimes(1);

    m.props.configs = [{ ...stale }];
    await settle();
    releaseRelated(true);
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t be refreshed');
    editRow(m.target);
    await settle();
    expect(m.target.querySelector('#ac-name')).toBeNull();
  });

  it('resets Manager-local credential and mutation state on a same-owner user change', async () => {
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'first');
    button(m.target, 'Save').click();
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
    expect($<HTMLInputElement>(m.target, '#ac-key')!.value).toBe('synthetic-key');

    m.props.currentUserId = 'u2';
    m.props.members = [{ user: { id: 'u2' }, role: 'ADMIN' }];
    await settle();
    expect(feedback(m.target).textContent).not.toContain('couldn’t confirm the change went through');
    expect(m.target.querySelector('#ac-key')).toBeNull();
    button(m.target, 'Add configuration').click();
    await settle();
    expect($<HTMLInputElement>(m.target, '#ac-key')!.value).toBe('');
    expect(button(m.target, 'Save').disabled).toBe(false);

    m.props.currentUserId = 'u1';
    m.props.members = [{ user: { id: 'u1' }, role: 'ADMIN' }];
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
  });

  it('settles an uncertain outcome through the callback captured at action start', async () => {
    let releaseCreate!: () => void;
    const createHeld = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const first = vi.fn();
    const second = vi.fn();
    stubFetch(async (body) => {
      if (body.action === 'create') {
        await createHeld;
        throw new Error('dropped response');
      }
      return {};
    });
    const m = await open({ onUncertain: first }, AiServiceConfigManager);
    await startCreate(m.target, 'first');
    button(m.target, 'Save').click();
    await tick(2);

    m.props.onUncertain = second;
    await settle();
    releaseCreate();
    await settle();
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: 'ORGANIZATION:o1' }));
    expect(second).not.toHaveBeenCalled();
  });

  it('does not carry a wrapped owner-A uncertainty lock into owner B', async () => {
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'first');
    button(m.target, 'Save').click();
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');

    m.props.ownerId = 'o2';
    await settle();
    expect(feedback(m.target).textContent).not.toContain('couldn’t confirm the change went through');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);

    m.props.ownerId = 'o1';
    await settle();
    expect(feedback(m.target).textContent).toContain('couldn’t confirm the change went through');
    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
  });

  it('drops the fragment from the explicit full-page readback link', async () => {
    window.history.replaceState({}, '', '/app/apps/a1?tab=ai-configs#some-anchor');
    stubFetch(async (body) => {
      if (body.action === 'create') throw new Error('dropped response');
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'first');
    button(m.target, 'Save').click();
    await settle();

    const reload = feedback(m.target).querySelector('a[data-sveltekit-reload]')!;
    expect(reload.getAttribute('href')).toBe('/app/apps/a1?tab=ai-configs');
  });

  it('explains why Save is disabled while committed readback is pending', async () => {
    let releaseReadback!: (reply: Reply) => void;
    stubFetch(() => ({}), () => new Promise<Reply>((resolve) => { releaseReadback = resolve; }));
    const m = await open();
    await startCreate(m.target, 'first');
    button(m.target, 'Save').click();
    await settle();
    expect(readbacks).toHaveLength(1);

    button(m.target, 'Add configuration').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(true);
    expect(m.target.textContent).toContain('Checking configurations before you can make another change…');
    const pending = $<HTMLElement>(m.target, '[data-testid="ai-config-recovery-pending"]')!;
    const status = $<HTMLElement>(m.target, '[data-testid="ai-config-manager-feedback"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.contains(pending)).toBe(true);
    releaseReadback({ body: { configs: [] } });
    await settle();
    expect(m.target.textContent).not.toContain('Checking configurations before you can make another change…');
  });

  it('preserves edits made while a Save request is in flight', async () => {
    let releaseUpdate!: (reply: Reply) => void;
    const original = config();
    stubFetch((body) => {
      if (body.action === 'update') return new Promise<Reply>((resolve) => { releaseUpdate = resolve; });
      return {};
    }, () => ({ body: { configs: [{ ...original, model: 'glm-6' }] } }));
    const m = await open({ configs: [original] });
    editRow(m.target);
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-6');
    button(m.target, 'Save').click();
    await settle();
    expect(releaseUpdate).toBeTypeOf('function');

    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-7');
    releaseUpdate({ body: { ok: true, config: { ...original, model: 'glm-6' } } });
    await settle();
    expect($<HTMLInputElement>(m.target, '#ac-model')!.value).toBe('glm-7');
    expect(feedback(m.target).textContent).toContain('Saved “default”.');
  });

  it('updates the created row when a preserved create draft is saved again', async () => {
    let releaseCreate!: (reply: Reply) => void;
    const created = config({ id: 'created-id', name: 'fast', model: 'glm-5' });
    stubFetch((body) => {
      if (body.action === 'create') return new Promise<Reply>((resolve) => { releaseCreate = resolve; });
      return {};
    }, () => ({ body: { configs: [created] } }));
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);

    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-7');
    releaseCreate({ body: { ok: true, config: created } });
    await settle();
    expect($<HTMLInputElement>(m.target, '#ac-model')!.value).toBe('glm-7');

    button(m.target, 'Save').click();
    await settle();
    const writes = posts.filter((body) => body.action === 'create' || body.action === 'update');
    expect(writes.map((body) => body.action)).toEqual(['create', 'update']);
    expect(writes[1]).toMatchObject({ id: 'created-id', model: 'glm-7' });
  });

  it('uses the returned created config as the edit baseline when readback omits it', async () => {
    let releaseCreate!: (reply: Reply) => void;
    const created = config({ id: 'created-id', name: 'fast', model: 'glm-5', endpoint: 'https://old.example' });
    stubFetch((body) => {
      if (body.action === 'create') return new Promise<Reply>((resolve) => { releaseCreate = resolve; });
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'fast');
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://old.example');
    button(m.target, 'Save').click();
    await tick(2);
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, '');
    releaseCreate({ body: { ok: true, config: created } });
    await settle();

    button(m.target, 'Save').click();
    await settle();
    const update = posts.find((body) => body.action === 'update');
    expect(update).toMatchObject({ id: 'created-id', endpoint: null });
  });

  it('refreshes the fallback baseline after a preserved update', async () => {
    let releaseCreate!: (reply: Reply) => void;
    let releaseUpdate!: (reply: Reply) => void;
    const created = config({ id: 'created-id', name: 'fast', model: 'glm-5' });
    stubFetch((body) => {
      if (body.action === 'create') return new Promise<Reply>((resolve) => { releaseCreate = resolve; });
      if (body.action === 'update') return new Promise<Reply>((resolve) => { releaseUpdate = resolve; });
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-6');
    releaseCreate({ body: { ok: true, config: created } });
    await settle();

    button(m.target, 'Save').click();
    await tick(2);
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-7');
    releaseUpdate({ body: { ok: true, config: { ...created, name: 'renamed', model: 'glm-6', hasApiKey: false } } });
    await settle();
    expect(m.target.querySelector('h3')?.textContent).toContain('renamed');
  });

  it('prefers the acknowledged saved row over an older retained row as the update baseline', async () => {
    // Readback RETAINS the older row (no endpoint). The user saves an explicit
    // endpoint, then clears it while that write is pending. The next save must
    // compare against the acknowledged row and send endpoint:null.
    let releaseUpdate!: (reply: Reply) => void;
    const older = config({ id: 'c1', name: 'default', endpoint: null });
    stubFetch((body) => {
      if (body.action === 'update') return new Promise<Reply>((resolve) => { releaseUpdate = resolve; });
      return {};
    });
    const m = await open({ configs: [older] }, AiServiceConfigManager);
    editRow(m.target);
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://new.example');
    button(m.target, 'Save').click();
    await tick(2);
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, '');
    releaseUpdate({ body: { ok: true, config: { ...older, endpoint: 'https://new.example' } } });
    await settle();
    expect(m.props.configs).toEqual([older]);

    button(m.target, 'Save').click();
    await settle();
    const updates = posts.filter((body) => body.action === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ id: 'c1', endpoint: 'https://new.example' });
    expect(updates[1]).toMatchObject({ id: 'c1', endpoint: null });
  });

  it('locks a preserved create draft when the response omits the created id', async () => {
    let releaseCreate!: (reply: Reply) => void;
    stubFetch((body) => {
      if (body.action === 'create') return new Promise<Reply>((resolve) => { releaseCreate = resolve; });
      return {};
    });
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await tick(2);
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-7');

    releaseCreate({});
    await settle();
    const region = feedback(m.target);
    expect(region.textContent).toContain('couldn’t confirm the change went through');
    expect(button(m.target, 'Save').disabled).toBe(true);
    expect(posts.filter((body) => body.action === 'create')).toHaveLength(1);
  });

  it('clears the previous owner search when the owner changes', async () => {
    const m = await open({ configs: [config({ name: 'fast' })] });
    set($<HTMLInputElement>(m.target, 'input[aria-label="Search AI provider configs"]')!, 'fast');

    m.props.ownerId = 'o2';
    m.props.configs = [config({ id: 'c2', name: 'default', ownerId: 'o2' })];
    await settle();
    expect(m.target.querySelector(`button[aria-label="${aiConfigStrings.actionsLabel('default')}"]`)).not.toBeNull();
  });
});

describe('#1898 follow-ups', () => {
  it('names the config in the visible delete question even when the name column is scrolled away', async () => {
    const m = await open({ configs: [config({ name: 'fast' })] });
    menuDelete(m.target, 'fast');
    await settle();
    const deleteButton = button(m.target, 'Delete');
    expect(deleteButton.parentElement?.textContent).toContain('fast');
    expect(deleteButton.parentElement?.textContent).toContain('cannot be undone');
    expect(posts.filter(p => p.action === 'delete')).toHaveLength(0);
  });
  it('fades Previous while the section editor holds pagination', async () => {
    const m = await open({ pagination: { offset: 20, count: 20, total: 60, previousHref: '?configOffset=0', nextHref: '?configOffset=40' } });
    await startCreate(m.target);
    const previous = [...m.target.querySelectorAll('[aria-disabled="true"]')].find(e => e.textContent === 'Previous');
    expect(previous).toBeDefined();
    expect(previous?.classList.contains('opacity-50')).toBe(true);
    expect(m.target.querySelector('a[rel="prev"]')).toBeNull();
  });
  it.each([401, 403])('keeps an auth-refused %i draft editable without replay lock', async (status) => {
    stubFetch(body => body.action === 'create' ? { ok: false, status, body: { error: status === 401 ? 'Unauthorized' : 'Forbidden' } } : {});
    const m = await open();
    await startCreate(m.target, 'fast');
    button(m.target, 'Save').click();
    await settle();
    expect(button(m.target, 'Save').disabled).toBe(false);
    expect($<HTMLInputElement>(m.target, '#ac-name')!.value).toBe('fast');
    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain(status === 401 ? 'Sign in again to save your draft.' : 'Forbidden');
    expect(feedback(m.target).textContent).not.toContain('couldn’t confirm');
    expect(readbacks).toHaveLength(0);
  });

  it.each(['create', 'update', 'delete'])('offers pathname-only new-tab recovery only after exact %s 401', async (action) => {
    window.history.replaceState({}, '', '/app/orgs/o1/integrations?private=synthetic#draft');
    let refused = true;
    stubFetch(body => body.action === action && refused
      ? { ok: false, status: 401, body: { error: 'untrusted-upstream-text' } } : {});
    const m = await open({ configs: action === 'create' ? [] : [config()] });
    const alert = m.target.querySelector('[data-testid="ai-config-error-feedback"]');
    expect(alert?.textContent?.trim()).toBe('');
    if (action === 'create') await startCreate(m.target, 'fast');
    else if (action === 'update') {
      editRow(m.target); await settle();
      set($<HTMLInputElement>(m.target, '#ac-model')!, 'new-model');
    } else { menuDelete(m.target); await settle(); }
    button(m.target, action === 'delete' ? 'Delete' : 'Save').click();
    await settle();
    expect(m.target.querySelector('[data-testid="ai-config-error-feedback"]')).toBe(alert);
    expect(alert?.textContent).toContain('Sign in again to save your draft.');
    expect(alert?.textContent).not.toContain('untrusted-upstream-text');
    const link = alert?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/signin?redirect=%2Fapp%2Forgs%2Fo1%2Fintegrations');
    expect(link?.target).toBe('_blank');
    expect(link?.rel.split(' ')).toContain('noopener');
    expect(link?.textContent).toContain('Sign in');
    expect(link?.textContent).toContain('new tab');
    const originalInput = m.target.querySelector('#ac-model');
    // Returning from a cancelled/successful tab does not replay or reload.
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(posts.filter(p => p.action === action)).toHaveLength(1);
    expect(m.target.querySelector('#ac-model')).toBe(originalInput);
    expect(alert?.querySelector('a')).toBe(link);
    expect(readbacks).toHaveLength(0);
    expect(navigationCalls).toHaveLength(0);
    refused = false;
    button(m.target, action === 'delete' ? 'Delete' : 'Save').click();
    await settle();
    expect(posts.filter(p => p.action === action)).toHaveLength(2);
    expect(alert?.querySelector('a')).toBeNull();
  });

  it.each([400, 403, 404, 500])('never offers sign-in for status %i even when its text claims Unauthorized', async status => {
    stubFetch(body => body.action === 'create'
      ? { ok: false, status, body: { error: 'Unauthorized' } } : {});
    const m = await open();
    await startCreate(m.target);
    button(m.target, 'Save').click(); await settle();
    expect(m.target.querySelector('a[href^="/signin"]')).toBeNull();
  });

});
