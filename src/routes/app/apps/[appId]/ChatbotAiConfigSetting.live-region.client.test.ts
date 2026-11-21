/**
 * portal#2375 — "Saved." after the chatbot AI config is saved is announced in a status region that
 * was already mounted and empty, not one inserted already populated (portal#2344).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import ChatbotAiConfigSetting from './ChatbotAiConfigSetting.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const choice = (value: string) => ({ value, name: value, provider: null, model: null, isDefault: false, isAppChatbotConfig: false, unavailableReason: null });

describe('chatbot AI config save result (portal#2375)', () => {
  it('"Saved." lands in the status region that was already mounted and empty', async () => {
    const m = mountComponent(ChatbotAiConfigSetting as never, {
      choices: [choice('cfg1'), choice('cfg2')],
      current: { ok: true, configId: null },
      manages: true,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const root = m.target;
    await tick();

    const idle = idleStatusRegions(root);
    expect(idle.length).toBeGreaterThan(0);

    const select = root.querySelector<HTMLSelectElement>('#chatbot-ai-config')!;
    select.value = 'cfg1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await submitEnhancedWithResult(root.querySelector('form')!, { type: 'success', status: 200, data: {} });
    await tick(3);

    const region = announcedStatusRegion(root);
    expect(region?.textContent).toContain('Saved.');
    expect(idle).toContain(region);
  });
});
