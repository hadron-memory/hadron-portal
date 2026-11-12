/**
 * portal#1346 — the "Vector index health" panel on memory settings: on demand,
 * read-only, only for a memory whose SAVED state is vector-indexed, and only
 * EMBED_FAILED findings, with the finding's `detail` escaped.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';

// #1465: the shared `$app` stubs, not hand-rolled shapes. `$app/stores` is aliased to the shared stub
// in the node lane already; forms and navigation are served by the same stub modules. `$app/environment`
// stays local on purpose: the shared stub says browser = true, and this file renders on the server.
vi.mock('$app/forms', () => import('$lib/test/stubs/app-forms'));
vi.mock('$app/navigation', () => import('$lib/test/stubs/app-navigation'));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
setStubPage('https://example.test/app/memories/mem-1/settings', { id: 'mem-1' });

import Page from './+page.svelte';

async function renderSettings(saved: boolean, actionData?: unknown) {
  const graph = settingsGraph({ vectorIndexEnabled: saved });
  const f = await settingsForms(graph, saved);
  return render(Page, {
    props: {
      data: { graph, user: OWNER, ownerUserId: OWNER_ID, owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' }, org: null, allOrgs: [], transferCanDelete: false, ...f } as never,
      form: (actionData ?? null) as never,
    },
  }).body;
}
const failed = (over: Record<string, unknown> = {}) => ({ nodeId: 'id1', nodeLoc: 'docs:a', nodeUrn: 'hrn:node:acme.com:mem:docs:a', detail: 'dimension mismatch', ...over });
const health = (over: Record<string, unknown> = {}) => ({ vectorHealth: { failed: [failed()], truncation: null, skipped: null, nodesChecked: 12 }, ...over });

describe('Vector index health panel (#1346)', () => {
  it('offers an on-demand button and shows no result before it is pressed', async () => {
    const html = await renderSettings(true);
    expect(html).toContain('Vector index health');
    expect(html).toContain('?/checkVectorIndexHealth');
    expect(html).toContain('Check vector index health');
    expect(html).not.toContain('data-testid="vector-health-row"');
  });

  it('shows no panel for a memory that is not saved as vector-indexed', async () => {
    const html = await renderSettings(false);
    expect(html).not.toContain('?/checkVectorIndexHealth');
    expect(html).not.toContain('Vector index health');
  });

  it('renders one row per failed node with the node link, its URN and the detail', async () => {
    const html = await renderSettings(true, health({ vectorHealth: { failed: [failed(), failed({ nodeId: 'id2', nodeLoc: 'docs:b', nodeUrn: null, detail: 'rejected' })], truncation: null, skipped: null, nodesChecked: 12 } }));
    expect(html.match(/data-testid="vector-health-row"/g)).toHaveLength(2);
    expect(html).toContain('/app/memories/mem-1/nodes/id1');
    expect(html).toContain('hrn:node:acme.com:mem:docs:a');
    expect(html).toContain('dimension mismatch');
    expect(html).toContain('rejected');
  });

  it('renders HTML in a detail as text', async () => {
    const html = await renderSettings(true, health({ vectorHealth: { failed: [failed({ detail: '<img src=x onerror=alert(1)>' })], truncation: null, skipped: null, nodesChecked: 1 } }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('says so explicitly when the response was truncated', async () => {
    const html = await renderSettings(true, health({ vectorHealth: { failed: [failed()], truncation: { shown: 1000, total: 1500 }, skipped: null, nodesChecked: 5000 } }));
    expect(html).toContain('Showing 1000 of 1500 findings');
    expect(html).toContain('other check kinds may hide embedding failures');
  });

  it('a complete response with no failures shows an explicit empty state', async () => {
    const html = await renderSettings(true, health({ vectorHealth: { failed: [], truncation: null, skipped: null, nodesChecked: 40 } }));
    expect(html).toContain('data-testid="vector-health-empty"');
  });

  it('a skipped embed check is not reported as an empty, healthy index', async () => {
    const html = await renderSettings(true, health({ vectorHealth: { failed: [], truncation: null, skipped: 'index offline', nodesChecked: 40 } }));
    expect(html).not.toContain('data-testid="vector-health-empty"');
    expect(html).toContain('index offline');
  });

  it('a refusal is a plain error state', async () => {
    const html = await renderSettings(true, { vectorHealthError: 'This memory could not be found.' });
    expect(html).toContain('This memory could not be found.');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-testid="vector-health-empty"');
  });
});
