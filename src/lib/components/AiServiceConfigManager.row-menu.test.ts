/**
 * #1020 — an AI config row's Edit and Delete live in the shared ⋯ menu.
 *
 * This grid was the last DataTable consumer still rendering individual
 * action buttons in the last column. Pinned in both directions so a copy
 * tweak cannot quietly bring the buttons back: the ⋯ trigger is there AND
 * no standalone Edit/Delete button renders. (The menu's own items are
 * jsdom territory — AssetTable/row-menu.client tests cover that idiom —
 * this pins the SSR surface.)
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import { aiConfigStrings } from '$lib/i18n/ai-config-strings';
import type { AiServiceConfig } from '$lib/types';

// The node lane has no `$app/*`; a server render never navigates.
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), beforeNavigate: vi.fn() }));

const CONFIG = {
  id: 'cfg-1',
  name: 'default',
  ownerType: 'ORGANIZATION',
  ownerId: 'org-1',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  endpoint: null,
  effectiveEndpoint: 'https://api.anthropic.com',
  apiStyle: null,
  effectiveApiStyle: null,
  hasApiKey: true,
  apiKeyPreview: '…abc',
  params: null,
  enabled: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: null,
} satisfies AiServiceConfig;

function body() {
  return render(AiServiceConfigManager, {
    props: { ownerType: 'ORGANIZATION', ownerId: 'org-1', configs: [CONFIG], canManage: true },
  }).body;
}

describe('AI config row ⋯ menu (#1020)', () => {
  it('offers the row actions behind one ⋯ trigger named for the config', () => {
    expect(body()).toContain(`aria-label="${aiConfigStrings.actionsLabel('default')}"`);
  });

  it('no longer renders standalone Edit or Delete buttons in the row', () => {
    const html = body();
    expect(html).not.toMatch(/>Edit<\/button>/);
    expect(html).not.toMatch(/>Delete<\/button>/);
  });

  it('still offers Add configuration (the canManage path is alive)', () => {
    expect(body()).toContain(aiConfigStrings.addButton());
  });
});
