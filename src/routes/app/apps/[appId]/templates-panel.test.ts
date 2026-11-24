/**
 * #1936 — the App's node-role templates are a tab of the App page now, not a
 * page of their own. Pins: the tab is addressable, its data is loaded for that
 * tab only, the legacy route still lands on it, and the sensitive-read cache
 * boundary the old page had (#1749 B1) moved with the data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { templatesPageData } from '$lib/server/memory-config/page-data';
import { resolveSectionIntent, resolveTabIntent } from './tab-intent';
import { loadTemplatesPanel } from './templates-panel';
import { load as legacyLoad } from './node-role-templates/+page.server';

vi.mock('$lib/server/memory-config/page-data', () => ({ templatesPageData: vi.fn() }));
const templatesMock = vi.mocked(templatesPageData);
const locals = { user: { id: 'user-1' }, token: 'token', impersonation: { sessionId: 's1' } } as never;

beforeEach(() => { templatesMock.mockReset(); });

function forbidden() {
  try { error(403, 'Forbidden'); } catch (e) { return e; }
}

describe('?tab=node-role-templates', () => {
  // The templates are a section of Settings now: the old tab id (and the legacy route's redirect to it) opens Settings with
  // that section unfolded, and the section's data is still read under this id.
  it('opens Settings with the Node-role templates section open', () => {
    const params = new URLSearchParams('tab=node-role-templates');
    expect(resolveTabIntent(params).initialTab).toBe('settings');
    expect(resolveSectionIntent(params)).toBe('node-role-templates');
  });
});

describe('loadTemplatesPanel', () => {
  it('loads nothing, and sets no header, for any other tab', async () => {
    const setHeaders = vi.fn();
    for (const tab of [null, 'chats', 'runs', 'settings']) {
      expect(await loadTemplatesPanel(tab, locals, setHeaders, 'app-1')).toBeNull();
    }
    expect(templatesMock).not.toHaveBeenCalled();
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it('loads the App’s templates under the actual principal and sets private no-store', async () => {
    templatesMock.mockResolvedValue({ templates: [], canManage: false, readOnly: true } as never);
    const setHeaders = vi.fn();
    const panel = await loadTemplatesPanel('node-role-templates', locals, setHeaders, 'app-1');
    expect(panel).toMatchObject({ canManage: false, readOnly: true });
    expect(templatesMock).toHaveBeenCalledExactlyOnceWith(locals, 'APP', 'app-1');
    expect(setHeaders).toHaveBeenCalledExactlyOnceWith({ 'cache-control': 'private, no-store' });
  });

  it('keeps private no-store, and the server’s refusal, when the read is refused', async () => {
    templatesMock.mockRejectedValue(forbidden());
    const setHeaders = vi.fn();
    let caught: unknown = 'none';
    try { await loadTemplatesPanel('node-role-templates', locals, setHeaders, 'app-1'); } catch (e) { caught = e; }
    expect((caught as { status?: number }).status).toBe(403);
    expect(setHeaders).toHaveBeenCalledExactlyOnceWith({ 'cache-control': 'private, no-store' });
  });
});

describe('legacy /app/apps/<id>/node-role-templates', () => {
  it('redirects to the tab, encoding the id', () => {
    for (const [id, want] of [['app-1', '/app/apps/app-1?tab=node-role-templates'], ['a b/c', '/app/apps/a%20b%2Fc?tab=node-role-templates']]) {
      try {
        legacyLoad({ params: { appId: id } } as never);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ status: 308, location: want });
      }
    }
    expect(templatesMock).not.toHaveBeenCalled();
  });
});
