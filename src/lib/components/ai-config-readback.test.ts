import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAiConfigList, readResolvedAiConfigs, withAiConfigTimeout } from './ai-config-readback';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const masked = {
  id: 'c1', name: 'default', ownerType: 'AGENT', ownerId: 'a1', provider: 'glm', model: 'glm-5',
  endpoint: null, effectiveEndpoint: 'https://api.z.ai/api/paas/v4',
  apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS',
  hasApiKey: true, apiKeyPreview: '…abcd', params: null, enabled: true,
  createdAt: '2026-09-26T00:00:00Z', updatedAt: null,
};

describe('AI configuration readback parser', () => {
  it('drops fields outside the fixed masked DTO instead of forwarding them', () => {
    const parsed = parseAiConfigList({
      configs: [{
        ...masked,
        apiKey: 'sk-synthetic-must-not-survive',
        authorization: 'Bearer synthetic-must-not-survive',
        unexpected: { credential: 'synthetic-must-not-survive' },
      }],
    });

    expect(parsed).toEqual([masked]);
    expect(JSON.stringify(parsed)).not.toContain('synthetic-must-not-survive');
  });

  it('rejects an unknown provider instead of casting it into the editor model', () => {
    expect(parseAiConfigList({ configs: [{ ...masked, provider: 'bogus' }] })).toBeNull();
  });

  it('settles a resolved-config read immediately when its caller aborts', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      requestSignal = init?.signal;
      return new Promise<Response>(() => {});
    }));
    const controller = new AbortController();
    let settled = false;
    const pending = readResolvedAiConfigs('app1', 'agent1', controller.signal);
    void pending.then(() => { settled = true; });

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
  });

  it('settles immediately when the externally supplied controller aborts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let settled = false;
    const pending = withAiConfigTimeout(
      () => new Promise<boolean>(() => {}),
      () => false,
      controller,
    );
    void pending.then(() => { settled = true; });

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await expect(pending).resolves.toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });
});
