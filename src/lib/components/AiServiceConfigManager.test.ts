/**
 * #924 — the AGENT surface's hint about which configuration the agent uses.
 *
 * It pointed at "the agent Chat tab", which no longer exists: an agent chats in
 * an App's Chats → Agent chat and in its Tester, and both resolve by name with
 * the App's own configuration first (spec 036). The copy is pinned so the old
 * claim cannot come back, and so it does not overclaim that every App uses the
 * agent's `default`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
import { getAiConfigRecoveryStore, resetAiConfigRecoveryForTests } from './ai-config-recovery';

// The node lane has no `$app/*`; a server render never navigates.
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), beforeNavigate: vi.fn() }));

afterEach(() => resetAiConfigRecoveryForTests());

function html(ownerType: 'AGENT' | 'ORGANIZATION' | 'APP') {
  return render(AiServiceConfigManager, { props: { ownerType, ownerId: 'x', currentUserId: 'u1', configs: [] } }).body;
}

describe('AiServiceConfigManager agent hint (#924)', () => {
  it('on an agent, names where the agent actually chats and that the App comes first', () => {
    const body = html('AGENT');
    expect(body).toContain('Agent chat');
    expect(body).toContain('Tester');
    expect(body).toContain('unless the App has its own configuration with the same name');
  });

  it('no longer points at the removed agent Chat tab', () => {
    expect(html('AGENT')).not.toMatch(/Chat tab/);
  });

  it('is shown only on the agent surface', () => {
    // The hint's CURRENT text, so this cannot pass vacuously on a copy change.
    const hint = aiConfigStrings.agentDefaultHint();
    expect(html('AGENT')).toContain(hint);
    expect(html('ORGANIZATION')).not.toContain(hint);
    expect(html('APP')).not.toContain(hint);
  });

  it('retains the store in the unguarded subscription control', () => {
    resetAiConfigRecoveryForTests();
    const store = getAiConfigRecoveryStore('standalone:leaky');
    store.subscribe(() => {});
    expect(getAiConfigRecoveryStore('standalone:leaky')).toBe(store);
  });

  it('does not retain a standalone recovery listener after SSR', () => {
    resetAiConfigRecoveryForTests();
    const store = getAiConfigRecoveryStore('standalone:u1');
    html('ORGANIZATION');

    // With no SSR listener, removing this temporary listener prunes the empty
    // store. A leaked render listener keeps the original store alive instead.
    const stop = store.subscribe(() => {});
    stop();
    expect(getAiConfigRecoveryStore('standalone:u1')).not.toBe(store);
  });
});
