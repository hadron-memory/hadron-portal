import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';

vi.mock('$app/forms', () => import('$lib/test/stubs/app-forms'));
vi.mock('$app/navigation', () => import('$lib/test/stubs/app-navigation'));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
setStubPage('https://example.test/app/memories/mem-1/settings', { id: 'mem-1' });

import Page from './+page.svelte';

describe('memory memory-config entry (#1749 B1)', () => {
  it('renders Manage node-role rules with preload-data off', async () => {
    const graph = settingsGraph();
    const forms = await settingsForms(graph);
    const html = render(Page, {
      props: {
        data: {
          graph,
          user: OWNER,
          ownerUserId: OWNER_ID,
          owner: { id: OWNER_ID, handle: 'reader', name: 'Reader' },
          org: null,
          allOrgs: [],
          transferCanDelete: false,
          roleConfigAvailable: true,
          ...forms,
        } as never,
        form: null as never,
      },
    }).body;
    const link = (html.match(/<a\b[^>]*>/g) ?? []).find((tag) => tag.includes('href="/app/memories/mem-1/settings/node-roles"'));
    expect(link).toBeDefined();
    expect(link).toContain('data-sveltekit-preload-data="off"');
  });
});
