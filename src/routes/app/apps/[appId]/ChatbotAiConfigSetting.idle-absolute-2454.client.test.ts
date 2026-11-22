/** portal#2454 — the save-result region in the chatbot AI config row goes out of flow with `idle:absolute`. */
import { afterEach, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { expectIdleAbsoluteRegion } from '$lib/test/idleAbsoluteRegion';
import ChatbotAiConfigSetting from './ChatbotAiConfigSetting.svelte';

let m: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { m?.unmount(); m = undefined; });
const choice = (value: string) => ({ value, name: value, provider: null, model: null, isDefault: false, isAppChatbotConfig: false, unavailableReason: null });

it('the idle region carries idle:absolute, not empty:absolute', async () => {
  m = mountComponent(ChatbotAiConfigSetting as never, { choices: [choice('a')], current: { ok: true, configId: null }, manages: true } as never) as Mounted<Record<string, unknown>>;
  await tick();
  await expectIdleAbsoluteRegion(m.target);
});
