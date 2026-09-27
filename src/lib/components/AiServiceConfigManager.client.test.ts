/**
 * #937 follow-up (server#1373 / #1389 / #1390): the endpoint, protocol and
 * tool-calling fields, mounted. What's pinned is what the form SENDS, since
 * that's what reaches the server: the three-way endpoint grammar, the key rule,
 * and which Test path an unsaved config may take.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import type { AiServiceConfig } from '$lib/types';

const GLM_ENDPOINTS = [
  { url: 'https://api.z.ai/api/paas/v4', label: 'Z.ai (general)', isDefault: true, note: 'Pay-as-you-go.' },
  { url: 'https://api.z.ai/api/coding/paas/v4', label: 'Z.ai Coding Plan', isDefault: false, note: 'Coding Plan subscription.' },
];

let posts: Array<Record<string, unknown>>;
beforeEach(() => {
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    posts.push(body);
    const reply = body.action === 'endpoints'
      ? { endpoints: body.provider === 'glm' ? GLM_ENDPOINTS : [] }
      : body.action === 'testSaved'
        ? { result: { ok: true, provider: 'glm', model: 'm', endpoint: 'https://api.z.ai/api/paas/v4', apiStyle: 'CHAT_COMPLETIONS', latencyMs: 5, reply: 'hi', error: null, used: { provider: 'SAVED', model: 'SAVED', endpoint: 'OVERRIDE', apiStyle: 'SAVED', key: 'SAVED' } } }
        : { ok: true };
    return { ok: true, json: async () => reply } as Response;
  }));
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
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

async function open(props: { ownerType?: string; configs?: AiServiceConfig[] } = {}) {
  const m = mountComponent(AiServiceConfigManager as never, {
    ownerType: props.ownerType ?? 'ORGANIZATION', ownerId: 'o1', configs: props.configs ?? [], canManage: true, allowTest: true,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m.target;
}
const $ = <T extends Element = HTMLElement>(root: HTMLElement, sel: string) => root.querySelector<T & HTMLElement>(sel);
function button(root: HTMLElement, text: string): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}
function set(el: HTMLInputElement | HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  flushSync();
}
// fetch → json → then, then invalidateAll: a few microtask hops each.
async function settle() {
  await tick(10);
  flushSync();
}

describe('openai-compatible', () => {
  it('requires an endpoint, offers the protocol and tool calling, and says the key is required', async () => {
    const root = await open();
    button(root, 'Add configuration').click();
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai-compatible');
    await settle();
    expect($(root, '#ac-endpoint-hint')!.textContent).toContain('Required: the base URL');
    const style = $<HTMLSelectElement>(root, '#ac-api-style')!;
    expect(style.options[0].textContent).toBe('Provider default (Chat Completions)');
    expect(root.textContent).toContain('This host supports tool calling');
    expect(root.textContent).toContain('Required: this configuration needs its own key.');

    set($<HTMLInputElement>(root, '#ac-name')!, 'local');
    set($<HTMLInputElement>(root, '#ac-model')!, 'qwen3');
    set($<HTMLInputElement>(root, '#ac-key')!, 'placeholder');
    button(root, 'Save').click();
    await settle();
    expect(root.textContent).toContain('An OpenAI-compatible provider needs an endpoint.');
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(0);

    set($<HTMLInputElement>(root, '#ac-endpoint')!, 'https://llm.example.com/v1');
    const tools = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) =>
      c.parentElement?.textContent?.includes('tool calling'),
    )!;
    tools.click();
    flushSync();
    button(root, 'Save').click();
    await settle();
    const create = posts.find((p) => p.action === 'create')!;
    expect(create).toMatchObject({
      provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', apiKey: 'placeholder', params: { toolCalling: true },
    });
    expect(create.apiStyle).toBeUndefined();
  });

  it('an unsaved one is never tested by the portal’s own client', async () => {
    const root = await open();
    button(root, 'Add configuration').click();
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'glm');
    set($<HTMLInputElement>(root, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(root, '#ac-key')!, 'k');
    button(root, 'Test').click();
    await settle();
    expect(root.textContent).toContain('Save this configuration first, then Test it');
    expect(posts.filter((p) => p.action === 'test')).toHaveLength(0);
  });
});

describe('a saved glm config', () => {
  it('suggests the server’s endpoints with their billing note, and names the default', async () => {
    const root = await open({ configs: [config()] });
    button(root, 'Edit').click();
    await settle();
    expect(posts).toContainEqual({ action: 'endpoints', provider: 'glm' });
    expect([...root.querySelectorAll('#ac-endpoint-options option')].map((o) => o.getAttribute('value'))).toEqual(
      GLM_ENDPOINTS.map((e) => e.url),
    );
    expect($(root, '#ac-endpoint-hint')!.textContent).toContain('provider default: https://api.z.ai/api/paas/v4');
    set($<HTMLInputElement>(root, '#ac-endpoint')!, 'https://api.z.ai/api/coding/paas/v4');
    expect($(root, '#ac-endpoint-hint')!.textContent).toContain('Coding Plan subscription.');
  });

  it('an unchanged endpoint is omitted from the update; a cleared one is sent as null', async () => {
    const root = await open({ configs: [config({ endpoint: 'https://api.z.ai/api/coding/paas/v4' })] });
    button(root, 'Edit').click();
    await settle();
    button(root, 'Save').click();
    await settle();
    expect('endpoint' in posts.find((p) => p.action === 'update')!).toBe(false);

    button(root, 'Edit').click();
    await settle();
    set($<HTMLInputElement>(root, '#ac-endpoint')!, '');
    button(root, 'Save').click();
    await settle();
    expect(posts.filter((p) => p.action === 'update')[1]).toMatchObject({ endpoint: null });
  });

  it('Test sends an edited endpoint as an override, and null when cleared', async () => {
    const root = await open({ configs: [config({ endpoint: 'https://api.z.ai/api/coding/paas/v4' })] });
    button(root, 'Edit').click();
    await settle();
    set($<HTMLInputElement>(root, '#ac-endpoint')!, '');
    button(root, 'Test').click();
    await settle();
    expect(posts.find((p) => p.action === 'testSaved')).toEqual({ action: 'testSaved', id: 'c1', override: { endpoint: null } });
  });

  it('a tenant config offers no "remove the key": the server refuses a keyless one (#1390)', async () => {
    const root = await open({ configs: [config()] });
    button(root, 'Edit').click();
    await settle();
    expect(root.textContent).not.toContain('Remove the stored key');
  });

  it('the platform’s own openai config may still drop its key', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER', configs: [config({ ownerType: 'HADRON_SERVER', provider: 'openai' })] });
    button(root, 'Edit').click();
    await settle();
    expect(root.textContent).toContain('Remove the stored key');
  });
});

describe('switching to Bedrock', () => {
  it('drops a hidden custom endpoint, so it is neither sent nor demanding a key', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER' });
    button(root, 'Add configuration').click();
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai');
    await settle();
    set($<HTMLInputElement>(root, '#ac-endpoint')!, 'https://proxy.example.com/v1');
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'bedrock');
    await settle();
    expect(root.querySelector('#ac-endpoint')).toBeNull();
    set($<HTMLInputElement>(root, '#ac-name')!, 'default');
    set($<HTMLInputElement>(root, '#ac-model')!, 'anthropic.claude');
    button(root, 'Save').click();
    await settle();
    // The platform's own bedrock config at its region host may go keyless.
    expect(root.textContent).not.toContain('needs its own API key');
    const create = posts.find((p) => p.action === 'create')!;
    expect(create.endpoint).toBeUndefined();
  });
});

describe('Test with "Remove the stored key" ticked', () => {
  it('tests the keyless state Save would produce (override apiKey: null)', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER', configs: [config({ ownerType: 'HADRON_SERVER', provider: 'openai' })] });
    button(root, 'Edit').click();
    await settle();
    const remove = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) =>
      c.parentElement?.textContent?.includes('Remove the stored key'),
    )!;
    remove.click();
    flushSync();
    button(root, 'Test').click();
    await settle();
    expect(posts.find((p) => p.action === 'testSaved')).toEqual({ action: 'testSaved', id: 'c1', override: { apiKey: null } });
  });

  it('without the box, the saved key is used (no apiKey in the override)', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER', configs: [config({ ownerType: 'HADRON_SERVER', provider: 'openai' })] });
    button(root, 'Edit').click();
    await settle();
    button(root, 'Test').click();
    await settle();
    expect(posts.find((p) => p.action === 'testSaved')).toEqual({ action: 'testSaved', id: 'c1', override: {} });
  });
});
