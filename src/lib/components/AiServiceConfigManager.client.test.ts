/**
 * #937 follow-up (server#1373 / #1389 / #1390): the endpoint, protocol and
 * tool-calling fields, mounted. What's pinned is what the form SENDS, since
 * that's what reaches the server: the three-way endpoint grammar, the key rule,
 * and which Test path an unsaved config may take.
 */
import { managerCallbacks } from '$lib/test/ai-config-manager-callbacks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import { resetAiConfigRecoveryForTests } from './ai-config-recovery';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
import type { AiServiceConfig } from '$lib/types';

const KIMI_ENDPOINTS = [
  { url: 'https://api.moonshot.ai/v1', label: 'Moonshot (international)', isDefault: true, note: null },
  { url: 'https://api.moonshot.cn/v1', label: 'Moonshot (China)', isDefault: false, note: null },
];

const GLM_ENDPOINTS = [
  { url: 'https://api.z.ai/api/paas/v4', label: 'Z.ai (general)', isDefault: true, note: 'Pay-as-you-go.' },
  { url: 'https://api.z.ai/api/coding/paas/v4', label: 'Z.ai Coding Plan', isDefault: false, note: 'Coding Plan subscription.' },
];

let posts: Array<Record<string, unknown>>;
let chatProbeStatus: string | null;
beforeEach(() => {
  resetAiConfigRecoveryForTests();
  posts = [];
  chatProbeStatus = null;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    if (_url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    posts.push(body);
    const reply = body.action === 'endpoints'
      ? { endpoints: body.provider === 'glm' ? GLM_ENDPOINTS : body.provider === 'kimi' ? KIMI_ENDPOINTS : [] }
      : body.action === 'testSaved'
        ? { result: { chat: chatProbeStatus === null ? null : { status: chatProbeStatus }, ok: true, provider: 'glm', model: 'm', endpoint: 'https://api.z.ai/api/paas/v4', apiStyle: 'CHAT_COMPLETIONS', latencyMs: 5, reply: 'hi', error: null, used: { provider: 'SAVED', model: 'SAVED', endpoint: 'OVERRIDE', apiStyle: 'SAVED', key: 'SAVED' } } }
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
    ...managerCallbacks(), ownerType: props.ownerType ?? 'ORGANIZATION', ownerId: 'o1', currentUserId: 'u1', configs: props.configs ?? [], canManage: true, allowTest: true,
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
// #1020 review (P2): the menu's Delete must ARM an inline confirm whose
// irreversibility question is visible — not post, and not rely on the
// menu item's title, which keyboard and touch users never see.
function menuDelete(root: HTMLElement, name = 'default'): void {
  const label = aiConfigStrings.actionsLabel(name);
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no ⋯ trigger for "${name}"`);
  trigger.click();
  flushSync();
  const item = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((x) => x.textContent?.trim() === 'Delete');
  if (!item) throw new Error('no Delete menu item');
  item.click();
  flushSync();
}
// #1020: a row's Edit lives behind its ⋯ menu, so opening the editor means
// opening the trigger, then the item — one config per test, named "default".
function editRow(root: HTMLElement, name = 'default'): void {
  const label = aiConfigStrings.actionsLabel(name);
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no ⋯ trigger for "${name}"`);
  trigger.click();
  flushSync();
  const item = [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((x) => x.textContent?.trim() === 'Edit');
  if (!item) throw new Error('no Edit menu item');
  item.click();
  flushSync();
}
function set(el: HTMLInputElement | HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  flushSync();
}
// fetch → json → then, then the host callback: a few microtask hops each.
async function settle() {
  await tick(10);
  flushSync();
}

// Wait for the actual control state around an immediate-response action,
// rather than budgeting a fixed number of promise hops for the identity read.
async function performAction(root: HTMLElement, label: string) {
  const trigger = button(root, label);
  await vi.waitFor(() => expect(trigger.disabled).toBe(false));
  trigger.click();
  flushSync();
  await vi.waitFor(() => expect(!trigger.isConnected || !trigger.disabled).toBe(true));
}

describe('kimi (#2138)', () => {
  async function pickKimi() {
    const root = await open();
    button(root, 'Add configuration').click();
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'kimi');
    await settle();
    return root;
  }

  it('is listed, pre-fills kimi-k3, offers the server-supplied hosts and the protocol, and no tool-calling toggle', async () => {
    const root = await pickKimi();
    const options = [...$<HTMLSelectElement>(root, '#ac-provider')!.options].map((o) => o.textContent);
    expect(options).toContain('Kimi (Moonshot)');
    expect($<HTMLInputElement>(root, '#ac-model')!.value).toBe('kimi-k3');
    // Endpoints come from the server's catalogue, never from the portal.
    expect(posts.filter((p) => p.action === 'endpoints').map((p) => p.provider)).toContain('kimi');
    const urls = [...root.querySelectorAll<HTMLOptionElement>('#ac-endpoint-options option')].map((o) => o.value);
    expect(urls).toEqual(['https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1']);
    expect($(root, '#ac-endpoint-hint')!.textContent).toContain('https://api.moonshot.ai/v1');
    expect($<HTMLInputElement>(root, '#ac-endpoint')!.placeholder).toBe('https://api.moonshot.ai/v1');
    expect($<HTMLSelectElement>(root, '#ac-api-style')!.options[0].textContent).toBe('Provider default (Chat Completions)');
    expect(root.textContent).not.toContain('This host supports tool calling');
  });

  it('saves provider kimi unchanged; an edited model goes through verbatim', async () => {
    const root = await pickKimi();
    set($<HTMLInputElement>(root, '#ac-name')!, 'moon');
    set($<HTMLInputElement>(root, '#ac-model')!, 'kimi-k4-preview');
    set($<HTMLInputElement>(root, '#ac-key')!, 'placeholder');
    await performAction(root, 'Save');
    const create = posts.find((p) => p.action === 'create')!;
    expect(create).toMatchObject({ provider: 'kimi', model: 'kimi-k4-preview', apiKey: 'placeholder' });
    expect(create.endpoint).toBeUndefined(); // the default host is the server's, not ours
    expect(create.params ?? null).toBeNull(); // no toolCalling knob for kimi
  });

  it('a padded model is saved verbatim for kimi (QA F1, portal#2155)', async () => {
    const root = await pickKimi();
    set($<HTMLInputElement>(root, '#ac-name')!, 'moon');
    set($<HTMLInputElement>(root, '#ac-model')!, '  QA/Kimi-Custom:Exact_v1  ');
    set($<HTMLInputElement>(root, '#ac-key')!, 'placeholder');
    await performAction(root, 'Save');
    expect(posts.find((p) => p.action === 'create')!.model).toBe('  QA/Kimi-Custom:Exact_v1  ');
  });

  it('the pre-filled model is saved as-is', async () => {
    const root = await pickKimi();
    set($<HTMLInputElement>(root, '#ac-name')!, 'moon');
    set($<HTMLInputElement>(root, '#ac-key')!, 'placeholder');
    await performAction(root, 'Save');
    expect(posts.find((p) => p.action === 'create')).toMatchObject({ provider: 'kimi', model: 'kimi-k3' });
  });

  it('switching away from an untouched offer clears it; a hand-edited model is kept', async () => {
    const root = await pickKimi();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai');
    await settle();
    expect($<HTMLInputElement>(root, '#ac-model')!.value).toBe('');
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'kimi');
    await settle();
    set($<HTMLInputElement>(root, '#ac-model')!, 'my-model');
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai');
    await settle();
    expect($<HTMLInputElement>(root, '#ac-model')!.value).toBe('my-model');
  });

  // #2181: Test must probe the string Save would leave (hrn:node:hadronmemory.com:specs:cor:dmo:050:10).
  describe('saved-config Test override model rule', () => {
    const saved = (over: Partial<AiServiceConfig>) => config({
      provider: 'kimi', model: '  kimi-k3 ', effectiveEndpoint: 'https://api.moonshot.ai/v1', ...over,
    });
    const overrideAfterTest = async (root: HTMLElement) => {
      await performAction(root, 'Test');
      const post = posts.find((p) => p.action === 'testSaved');
      expect(post, 'Test should have posted testSaved').toBeDefined();
      return post!.override as Record<string, unknown>;
    };
    const flip = async (root: HTMLElement, provider: string) => {
      set($<HTMLSelectElement>(root, '#ac-provider')!, provider);
      await settle();
    };

    it('an unchanged padded kimi model sends no model override', async () => {
      const root = await open({ configs: [saved({})] });
      editRow(root);
      await settle();
      expect($<HTMLInputElement>(root, '#ac-model')!.value).toBe('  kimi-k3 ');
      expect('model' in await overrideAfterTest(root)).toBe(false);
    });

    it('a changed padded kimi model is sent verbatim', async () => {
      const root = await open({ configs: [saved({})] });
      editRow(root);
      await settle();
      set($<HTMLInputElement>(root, '#ac-model')!, '  kimi-k4 ');
      await settle();
      expect((await overrideAfterTest(root)).model).toBe('  kimi-k4 ');
    });

    it('a non-kimi provider still trims its model override', async () => {
      const root = await open({ configs: [config({ provider: 'glm', model: 'glm-5' })] });
      editRow(root);
      await settle();
      set($<HTMLInputElement>(root, '#ac-model')!, '  glm-6 ');
      await settle();
      expect((await overrideAfterTest(root)).model).toBe('glm-6');
    });

    it('switching a padded kimi config to another provider trims the model (live provider rules)', async () => {
      const root = await open({ configs: [saved({})] });
      editRow(root);
      await settle();
      await flip(root, 'openai');
      const o = await overrideAfterTest(root);
      expect(o.provider).toBe('openai');
      expect(o.model).toBe('kimi-k3');
    });

    it('switching a padded non-kimi config to kimi sends the model verbatim', async () => {
      const root = await open({ configs: [config({ provider: 'glm', model: 'glm-5' })] });
      editRow(root);
      await settle();
      set($<HTMLInputElement>(root, '#ac-model')!, '  kimi-k3 ');
      await flip(root, 'kimi');
      const o = await overrideAfterTest(root);
      expect(o.provider).toBe('kimi');
      expect(o.model).toBe('  kimi-k3 ');
    });

    for (const [label, cfg] of [
      ['kimi', saved({})],
      ['non-kimi', config({ provider: 'glm', model: 'glm-5' })],
    ] as const) {
      it(`a cleared or whitespace-only model on a ${label} config is refused like Save, with no test post`, async () => {
        for (const blank of ['', '   ']) {
          const root = await open({ configs: [cfg] });
          editRow(root);
          await settle();
          set($<HTMLInputElement>(root, '#ac-model')!, blank);
          await settle();
          await performAction(root, 'Test');
          expect(root.textContent).toContain(aiConfigStrings.modelRequired());
          expect(posts.filter((p) => p.action === 'testSaved')).toHaveLength(0);
        }
      });
    }
  });

  it('a saved kimi config whose model equals the offered default keeps it when the provider is switched away', async () => {
    const root = await open({ configs: [config({ provider: 'kimi', model: 'kimi-k3', effectiveEndpoint: 'https://api.moonshot.ai/v1' })] });
    editRow(root);
    await settle();
    expect($<HTMLInputElement>(root, '#ac-model')!.value).toBe('kimi-k3');
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai');
    await settle();
    expect($<HTMLInputElement>(root, '#ac-model')!.value).toBe('kimi-k3');
  });

  it('Test on an unsaved kimi config asks to save first and posts nothing to the test route', async () => {
    const root = await pickKimi();
    set($<HTMLInputElement>(root, '#ac-key')!, 'placeholder');
    await performAction(root, 'Test');
    expect(root.textContent).toContain(aiConfigStrings.testSaveFirst());
    expect(posts.filter((p) => p.action === 'test')).toHaveLength(0);
  });
});

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
    await performAction(root, 'Save');
    expect(root.textContent).toContain('An OpenAI-compatible provider needs an endpoint.');
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(0);

    set($<HTMLInputElement>(root, '#ac-endpoint')!, 'https://llm.example.com/v1');
    const tools = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) =>
      c.parentElement?.textContent?.includes('tool calling'),
    )!;
    tools.click();
    flushSync();
    await performAction(root, 'Save');
    const create = posts.find((p) => p.action === 'create')!;
    expect(create).toMatchObject({
      provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', apiKey: 'placeholder', params: { toolCalling: true },
    });
    expect(create.apiStyle).toBeUndefined();
  });

  it('switching a saved one to another provider drops its hidden toolCalling from the update (#951)', async () => {
    // Chip's repro: the toggle owns toolCalling and is hidden once the provider
    // changes, so the update must replace params WITHOUT it, keeping other knobs.
    const saved = config({ provider: 'openai-compatible', model: 'qwen3', endpoint: 'https://llm.example.com/v1', params: { toolCalling: true } });
    let root = await open({ configs: [saved] });
    editRow(root);
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'glm');
    set($<HTMLInputElement>(root, '#ac-endpoint')!, '');
    await settle();
    await performAction(root, 'Save');
    let update = posts.find((p) => p.action === 'update')!;
    expect(update).toMatchObject({ provider: 'glm', endpoint: null });
    expect(update).toHaveProperty('params', null); // cleared, not "unchanged"

    posts.length = 0;
    const withKnob = config({ ...saved, id: 'c2', params: { toolCalling: true, temperature: 0.3 } });
    mounted.pop()!.unmount();
    root = await open({ configs: [withKnob] });
    editRow(root);
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'glm');
    set($<HTMLInputElement>(root, '#ac-endpoint')!, '');
    await settle();
    await performAction(root, 'Save');
    update = posts.find((p) => p.action === 'update')!;
    expect(update.params).toEqual({ temperature: 0.3 });
  });

  it('an unsaved one is never tested by the portal’s own client', async () => {
    const root = await open();
    button(root, 'Add configuration').click();
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'glm');
    set($<HTMLInputElement>(root, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(root, '#ac-key')!, 'k');
    await performAction(root, 'Test');
    expect(root.textContent).toContain('Save this configuration first, then Test it');
    expect(posts.filter((p) => p.action === 'test')).toHaveLength(0);
  });
});

describe('a saved glm config', () => {
  it('suggests the server’s endpoints with their billing note, and names the default', async () => {
    const root = await open({ configs: [config()] });
    editRow(root);
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
    editRow(root);
    await settle();
    await performAction(root, 'Save');
    expect('endpoint' in posts.find((p) => p.action === 'update')!).toBe(false);

    editRow(root);
    await settle();
    set($<HTMLInputElement>(root, '#ac-endpoint')!, '');
    await performAction(root, 'Save');
    expect(posts.filter((p) => p.action === 'update')[1]).toMatchObject({ endpoint: null });
  });

  it('Test sends an edited endpoint as an override, and null when cleared', async () => {
    const root = await open({ configs: [config({ endpoint: 'https://api.z.ai/api/coding/paas/v4' })] });
    editRow(root);
    await settle();
    set($<HTMLInputElement>(root, '#ac-endpoint')!, '');
    await performAction(root, 'Test');
    expect(posts.find((p) => p.action === 'testSaved')).toEqual({ action: 'testSaved', id: 'c1', override: { endpoint: null } });
  });

  it('a tenant config offers no "remove the key": the server refuses a keyless one (#1390)', async () => {
    const root = await open({ configs: [config()] });
    editRow(root);
    await settle();
    expect(root.textContent).not.toContain('Remove the stored key');
  });

  it('the platform’s own openai config may still drop its key', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER', configs: [config({ ownerType: 'HADRON_SERVER', provider: 'openai' })] });
    editRow(root);
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
    await performAction(root, 'Save');
    // The platform's own bedrock config at its region host may go keyless.
    expect(root.textContent).not.toContain('needs its own API key');
    const create = posts.find((p) => p.action === 'create')!;
    expect(create.endpoint).toBeUndefined();
  });
});

describe('Test with "Remove the stored key" ticked', () => {
  it('tests the keyless state Save would produce (override apiKey: null)', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER', configs: [config({ ownerType: 'HADRON_SERVER', provider: 'openai' })] });
    editRow(root);
    await settle();
    const remove = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) =>
      c.parentElement?.textContent?.includes('Remove the stored key'),
    )!;
    remove.click();
    flushSync();
    await performAction(root, 'Test');
    expect(posts.find((p) => p.action === 'testSaved')).toEqual({ action: 'testSaved', id: 'c1', override: { apiKey: null } });
  });

  it('without the box, the saved key is used (no apiKey in the override)', async () => {
    const root = await open({ ownerType: 'HADRON_SERVER', configs: [config({ ownerType: 'HADRON_SERVER', provider: 'openai' })] });
    editRow(root);
    await settle();
    await performAction(root, 'Test');
    expect(posts.find((p) => p.action === 'testSaved')).toEqual({ action: 'testSaved', id: 'c1', override: {} });
  });
});

describe('Test with edited Parameters (#951 Codex P2, hadron-server#1413)', () => {
  const testSavedOverride = () => posts.find((p) => p.action === 'testSaved')!.override as Record<string, unknown>;
  function typeParams(root: HTMLElement, text: string) {
    const params = $<HTMLTextAreaElement>(root, '#ac-params')!;
    params.value = text;
    params.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  it('tests the edited params, exactly as Save would write them', async () => {
    const root = await open({ configs: [config({ params: { maxTokens: 100 } })] });
    editRow(root);
    await settle();
    typeParams(root, '{"maxTokens": 500}');
    await performAction(root, 'Test');
    expect(testSavedOverride().params).toEqual({ maxTokens: 500 });
    expect(root.textContent).not.toContain('weren’t part of this test');
  });

  it('a flipped tool-calling toggle is tested, not the stored flag', async () => {
    const root = await open({
      configs: [config({ provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', params: { toolCalling: true, maxTokens: 100 } })],
    });
    editRow(root);
    await settle();
    root.querySelector<HTMLInputElement>('input[aria-describedby="ac-tool-calling-hint"]')!.click();
    flushSync();
    await performAction(root, 'Test');
    expect(testSavedOverride().params).toEqual({ toolCalling: false, maxTokens: 100 });
  });

  it('cleared params are sent as null (the provider defaults), not omitted', async () => {
    const root = await open({ configs: [config({ params: { maxTokens: 100 } })] });
    editRow(root);
    await settle();
    typeParams(root, '');
    await performAction(root, 'Test');
    const override = testSavedOverride();
    expect('params' in override).toBe(true);
    expect(override.params).toBeNull();
  });

  it('unchanged params are omitted, so the saved ones are used', async () => {
    const root = await open({
      configs: [config({ provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', params: { toolCalling: true, maxTokens: 100 } })],
    });
    editRow(root);
    await settle();
    await performAction(root, 'Test');
    expect('params' in testSavedOverride()).toBe(false);
  });

  it('unparseable params are refused like Save refuses them, before any request', async () => {
    const root = await open({ configs: [config({ params: { maxTokens: 100 } })] });
    editRow(root);
    await settle();
    typeParams(root, '{nope');
    await performAction(root, 'Test');
    expect(root.textContent).toContain('Params must be valid JSON.');
    expect(posts.some((p) => p.action === 'testSaved')).toBe(false);
  });
});

describe('Test with the Model field cleared', () => {
  it('is refused like Save, before any request', async () => {
    const root = await open({ configs: [config()] });
    editRow(root);
    await settle();
    set($<HTMLInputElement>(root, '#ac-model')!, '');
    await performAction(root, 'Test');
    expect(root.textContent).toContain('Provider and model are required.');
    expect(posts.filter((p) => p.action === 'testSaved')).toHaveLength(0);
  });
});

describe('endpoint suggestions follow the provider (#951 Codex P2)', () => {
  /** Endpoints replies for `held` providers wait until released; everything else answers at once. */
  function holdEndpoints(held: string[]) {
    const release = new Map<string, (urls: string[]) => void>();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      if (_url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
    const body = JSON.parse(init.body) as Record<string, unknown>;
      posts.push(body);
      if (body.action === 'endpoints' && held.includes(String(body.provider))) {
        const urls = await new Promise<string[]>((r) => release.set(String(body.provider), r));
        return { ok: true, json: async () => ({ endpoints: urls.map((url) => ({ url, label: url, isDefault: true, note: null })) }) } as Response;
      }
      const reply = body.action === 'endpoints' ? { endpoints: body.provider === 'glm' ? GLM_ENDPOINTS : [] } : { ok: true };
      return { ok: true, json: async () => reply } as Response;
    }));
    return release;
  }
  const offered = (root: HTMLElement) =>
    [...root.querySelectorAll('#ac-endpoint-options option')].map((o) => o.getAttribute('value'));

  it('switching provider drops the previous provider’s URLs at once, not when the new reply lands', async () => {
    holdEndpoints(['openai']);
    const root = await open({ configs: [config()] });
    editRow(root);
    await settle();
    expect(offered(root)).toEqual(GLM_ENDPOINTS.map((e) => e.url));

    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai'); // reply still in flight
    await settle();
    expect(offered(root)).toEqual([]);
    expect($(root, '#ac-endpoint-hint')?.textContent ?? '').not.toContain('api.z.ai');
  });

  it('a reply that lands after a switch to Bedrock never reappears', async () => {
    const release = holdEndpoints(['openai', 'openai-compatible']);
    const root = await open({ configs: [config()] });
    editRow(root);
    await settle();

    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai'); // in flight
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'bedrock');
    await settle();
    release.get('openai')!(['https://stale.example/v1']); // the late openai reply
    await settle();
    set($<HTMLSelectElement>(root, '#ac-provider')!, 'openai-compatible'); // its own reply held
    await settle();
    expect(offered(root)).not.toContain('https://stale.example/v1');
  });
});

describe('AI config Delete confirm (#1020 review P2)', () => {
  it('arms an inline confirm whose "cannot be undone" question is visible, posting nothing yet', async () => {
    const root = await open({ configs: [config()] });
    menuDelete(root);
    await settle();
    expect(root.textContent).toContain(aiConfigStrings.confirmDelete('default'));
    expect(posts.filter((p) => p.action === 'delete')).toHaveLength(0);
    // The confirm's own Delete is what posts, for the armed config.
    await performAction(root, 'Delete');
    expect(posts.find((p) => p.action === 'delete')).toMatchObject({ id: 'c1' });
  });
});

describe('a late save response must not replace the replacement editor’s baseline (#1910)', () => {
  /** The Manager mounted on reactive props, so the owner visit can change mid-test. */
  function openReactive(props: { configs?: AiServiceConfig[] } = {}) {
    const m = mountComponent(AiServiceConfigManager as never, reactiveProps({
      ...managerCallbacks(), ownerType: 'ORGANIZATION', ownerId: 'o1', currentUserId: 'u1',
      configs: props.configs ?? [], canManage: true, allowTest: true,
    } as never) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    return m;
  }
  /**
   * `action`-typed write replies (create/update) wait until released and answer
   * with the released row; everything else answers at once. `delivered` resolves
   * only once the held response's JSON has actually been consumed, so a test can
   * await the landing instead of guessing a tick count.
   */
  function holdWrites(action: 'create' | 'update'): {
    release: (row: AiServiceConfig) => void;
    delivered: Promise<void>;
  } {
    let release!: (row: AiServiceConfig) => void;
    let delivered!: () => void;
    const held = new Promise<AiServiceConfig>((resolve) => { release = resolve; });
    const deliveredRow = new Promise<void>((resolve) => { delivered = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      if (_url === '/api/ai-configs/principal') return { ok: true, json: async () => ({ principal: { principalType: 'USER', userId: 'u1', appId: null } }) } as Response;
      const body = JSON.parse(init.body) as Record<string, unknown>;
      posts.push(body);
      if (body.action === action) {
        const row = await held;
        return { ok: true, json: async () => { delivered(); return { ok: true, config: row }; } } as Response;
      }
      const reply = body.action === 'endpoints'
        ? { endpoints: body.provider === 'glm' ? GLM_ENDPOINTS : [] }
        : { ok: true };
      return { ok: true, json: async () => reply } as Response;
    }));
    return { release, delivered: deliveredRow };
  }
  /**
   * Settle after releasing a held write. `delivered` resolves when the response
   * JSON is consumed, so this cannot pass before the response has landed; the
   * remaining save() continuation is a bounded microtask chain (post →
   * seedBaseline → onSuccess → finishMutation), drained by the trailing ticks —
   * not a guess at when the response might arrive. Whether the write was
   * dropped or applied, it surfaces no error: the feedback element must EXIST
   * (or the emptiness claim would pass vacuously) and be empty.
   */
  async function settleAfterDelivery(delivered: Promise<void>, target: HTMLElement) {
    await delivered;
    await tick(30);
    const feedback = $(target, '[data-testid="ai-config-error-feedback"]');
    expect(feedback).not.toBe(null);
    expect(feedback?.textContent ?? '').toBe('');
  }

  it('diffs against the freshest row it knows after a reopen, not the stale save’s row', async () => {
    const { release, delivered } = holdWrites('update');
    const row = config({ endpoint: 'https://fresh.example/v1' });
    const m = openReactive({ configs: [row] });
    await tick();
    editRow(m.target);
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://stale.example/v1');
    await vi.waitFor(() => expect(button(m.target, 'Save').disabled).toBe(false));
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(posts.some(p => p.action === 'update')).toBe(true)); // the update is in flight, held
    expect(posts.find((p) => p.action === 'update')).toMatchObject({ endpoint: 'https://stale.example/v1' });

    // The owner visit changes while the response is in flight, closing the
    // editor. The pending mutation belongs to the old visit, so the same row
    // may be reopened now.
    (m.props as { ownerId: string }).ownerId = 'o2';
    await vi.waitFor(() => expect($(m.target, '#ac-endpoint')).toBe(null)); // the editor really closed, observed rather than guessed
    editRow(m.target); // the replacement editor, seeded from the list row
    await settle();

    release({ ...row, endpoint: 'https://stale.example/v1' }); // the old save’s late response
    await settleAfterDelivery(delivered, m.target);

    await performAction(m.target, 'Save'); // fields unchanged since the reopen
    const updates = posts.filter((p) => p.action === 'update');
    expect(updates).toHaveLength(2);
    const second = updates[1]!;
    // The reopened editor diffs against the freshest row it knows — here the
    // list row it was reopened against (endpoint unchanged ⇒ omitted). A late
    // response that seeded the baseline instead would send
    // endpoint: 'https://fresh.example/v1' as a spurious change.
    expect('endpoint' in second).toBe(false);
  });

  it('a late create response must not seed the baseline of a later edit of the new row', async () => {
    const { release, delivered } = holdWrites('create');
    const m = openReactive({ configs: [] });
    await tick();
    button(m.target, 'Add configuration').click();
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-name')!, 'made');
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(m.target, '#ac-key')!, 'sk-test');
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://made.example/v1');
    await vi.waitFor(() => expect(button(m.target, 'Save').disabled).toBe(false));
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(posts.some(p => p.action === 'create')).toBe(true)); // the create is in flight, held
    expect(posts.find((p) => p.action === 'create')).toMatchObject({ name: 'made', endpoint: 'https://made.example/v1' });

    // The owner visit changes while the response is in flight, closing the
    // create editor. The pending mutation is scoped to the old visit, so rows
    // are openable again.
    (m.props as { ownerId: string }).ownerId = 'o2';
    await vi.waitFor(() => expect($(m.target, '#ac-endpoint')).toBe(null)); // the editor really closed, observed rather than guessed
    // The committed readback delivers the new row into the visible list — as
    // a LATER write left it (fresh endpoint), not as the delayed response's copy.
    (m.props as { configs: AiServiceConfig[] }).configs = [config({ id: 'c9', name: 'made', endpoint: 'https://fresh.example/v1' })];
    await settle();
    editRow(m.target, 'made'); // the replacement editor, seeded from the fresh row
    await settle();

    release(config({ id: 'c9', name: 'made', endpoint: 'https://made.example/v1' })); // the create’s late response
    await settleAfterDelivery(delivered, m.target);

    await performAction(m.target, 'Save'); // fields unchanged since the reopen
    const updates = posts.filter((p) => p.action === 'update');
    expect(updates).toHaveLength(1);
    const only = updates[0]!;
    // Dropped: the diff follows the fresh list row (endpoint unchanged ⇒
    // omitted). An unfenced response would seed the older row and send
    // endpoint: 'https://fresh.example/v1' as a spurious change.
    expect('endpoint' in only).toBe(false);
  });

  it('a current create converts a preserved draft into an update of the new row, never a second create', async () => {
    const { release, delivered } = holdWrites('create');
    const m = openReactive({ configs: [] });
    await tick();
    button(m.target, 'Add configuration').click();
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-name')!, 'made');
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(m.target, '#ac-key')!, 'sk-test');
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://made.example/v1');
    await vi.waitFor(() => expect(button(m.target, 'Save').disabled).toBe(false));
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(posts.some(p => p.action === 'create')).toBe(true)); // the create is in flight, held
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://edited.example/v1'); // newer edit mid-flight

    release(config({ id: 'c9', name: 'made', endpoint: 'https://made.example/v1' }));
    await settleAfterDelivery(delivered, m.target);
    // The draft was preserved (fingerprint differs), so the editor stays open —
    // as an UPDATE of the new row, which only createdId can make it.
    expect($(m.target, '#ac-endpoint')).not.toBe(null);
    expect(($<HTMLInputElement>(m.target, '#ac-endpoint')!).value).toBe('https://edited.example/v1');

    await performAction(m.target, 'Save');
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1); // never a second create
    expect(posts.find((p) => p.action === 'update')).toMatchObject({ id: 'c9', endpoint: 'https://edited.example/v1' });
  });

  it('a create superseded by a delete-arm in the same session still converts the draft; a second Save updates, never re-creates', async () => {
    const { release, delivered } = holdWrites('create');
    const m = openReactive({ configs: [config()] }); // an unrelated row to arm
    await tick();
    button(m.target, 'Add configuration').click();
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-name')!, 'made');
    set($<HTMLInputElement>(m.target, '#ac-model')!, 'glm-5');
    set($<HTMLInputElement>(m.target, '#ac-key')!, 'sk-test');
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://made.example/v1');
    await vi.waitFor(() => expect(button(m.target, 'Save').disabled).toBe(false));
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(posts.some(p => p.action === 'create')).toBe(true)); // the create is in flight, held
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://edited.example/v1'); // newer edit mid-flight
    // Arming the unrelated row's delete supersedes the save's ACTION
    // (actionGeneration bump, ungated by busy) without ending the editor
    // session — the editor stays open with its draft.
    menuDelete(m.target);
    expect(m.target.textContent).toContain(aiConfigStrings.confirmDelete('default'));

    release(config({ id: 'c9', name: 'made', endpoint: 'https://made.example/v1' }));
    await delivered;
    await tick(30);
    // The superseded create still belongs to this editor session: the preserved
    // draft converts to an update of the new row. Gating on action generation
    // instead would leave the draft a CREATE, and the next Save would POST a
    // second create — the duplicate-row window.
    expect($(m.target, '#ac-endpoint')).not.toBe(null);

    await performAction(m.target, 'Save');
    expect(posts.filter((p) => p.action === 'create')).toHaveLength(1); // never a second create
    expect(posts.find((p) => p.action === 'update')).toMatchObject({ id: 'c9', endpoint: 'https://edited.example/v1' });
  });

  // #1984: a BEHAVIOUR pin, not the session fence's discriminating pin. The
  // pending lock keeps the row unopenable until the response lands, and
  // openEdit re-seeds from the list row, so a stale response that set
  // savedConfig is masked in the DOM either way: this test stays green with
  // every endEditorSession() call removed. The fence is discriminated by
  // AiServiceConfigManager.feedback.client.test.ts 'keeps Cancel → reopen →
  // Save from overlapping a pending mutation' (held create → Cancel → Add →
  // Save stays disabled), which fails without them.
  it('a cancelled editor’s row reopens cleanly with no spurious diff', async () => {
    const { release, delivered } = holdWrites('update');
    const row = config({ endpoint: 'https://fresh.example/v1' });
    const m = openReactive({ configs: [row] });
    await tick();
    editRow(m.target);
    await settle();
    set($<HTMLInputElement>(m.target, '#ac-endpoint')!, 'https://stale.example/v1');
    await vi.waitFor(() => expect(button(m.target, 'Save').disabled).toBe(false));
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(posts.some(p => p.action === 'update')).toBe(true)); // the update is in flight, held

    // Cancel closes the editor; the visit is unchanged. The pending mutation
    // keeps the row unopenable until it settles, so the reopen can only happen
    // after the response landed.
    button(m.target, 'Cancel').click();
    await settle();
    expect($(m.target, '#ac-endpoint')).toBe(null);

    release({ ...row, endpoint: 'https://stale.example/v1' });
    await settleAfterDelivery(delivered, m.target);

    editRow(m.target); // a new session, seeded from the list row
    await settle();
    await performAction(m.target, 'Save'); // fields unchanged since the reopen
    const updates = posts.filter((p) => p.action === 'update');
    expect(updates).toHaveLength(2);
    expect('endpoint' in updates[1]!).toBe(false); // no spurious endpoint change
  });
});


describe('#2043 separately labelled saved Test outcomes', () => {
  it.each([
    ['PASS', 'Passed: the model returned one valid response.'],
    ['FAIL_TEXT_ONLY', 'Failed: the model answered in text instead of using its response tool.'],
    ['FAIL_OTHER_TOOL', 'Failed: the model called a different tool.'],
    ['FAIL_MULTIPLE_CALLS', 'Failed: the model called more than one tool.'],
    ['FAIL_MALFORMED', 'Failed: the model returned an invalid response.'],
    ['FAIL_PROVIDER_UNAVAILABLE', 'The chat test could not complete. Check the provider settings and try again.'],
    ['UNSUPPORTED_PROVIDER', 'Chat testing is not supported by this provider.'],
  ])('renders %s alongside a successful run result', async (status, copy) => {
    chatProbeStatus = status;
    const root = await open({ configs: [config()] });
    editRow(root);
    await settle();
    const region = root.querySelector('[data-testid="ai-config-test-feedback"]');
    expect(region).not.toBeNull();
    expect(region?.textContent?.trim()).toBe('');
    await performAction(root, 'Test');
    expect(root.querySelector('[data-testid="ai-config-test-feedback"]')).toBe(region);
    expect(root.querySelector('[data-testid="ai-config-test-run"]')?.textContent).toContain('Run');
    expect(root.querySelector('[data-testid="ai-config-test-run"]')?.textContent).toContain('Works:');
    const chat = root.querySelector('[data-testid="ai-config-test-chat"]');
    expect(chat?.textContent).toContain('Chat');
    expect(chat?.textContent).toContain(copy);
  });
  it('null chat on an older response renders the labelled run only', async () => {
    const root = await open({ configs: [config()] });
    editRow(root); await settle(); await performAction(root, 'Test');
    expect(root.querySelector('[data-testid="ai-config-test-run"]')?.textContent).toContain('Works:');
    expect(root.querySelector('[data-testid="ai-config-test-chat"]')).toBeNull();
  });
});
