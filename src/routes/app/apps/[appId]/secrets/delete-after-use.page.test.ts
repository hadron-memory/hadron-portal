/**
 * portal#2679 — the delete-after-use switch and its three states, rendered on the server:
 * off, on, and staged (a request waiting for the passkey). The ceremony notice names the two new
 * operations in plain words. Red on main: none of it rendered.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', () => ({ page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/') }), () => {}) } }));
import Detail from './[secretId]/+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const secret = { id: 's1', ownerType: 'app', ownerId: 'app-1', name: 'stripe-key', kind: 'generic', protected: true, deleteAfterUse: false, currentVersion: 2, metadata: null, createdAt: '2026-11-01T00:00:00Z', createdBy: 'u1', updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'u1' };
const LINK = 'https://hadron.example/secret-changes/r1';
const pending = (operation: string, state = 'open') => ({ requestId: 'r1', secretId: 's1', ceremonyUrl: LINK, state, operation, expiresAt: '2099-01-01T00:00:00Z' });

const switchTag = (html: string) => html.match(/<button\b[^>]*role="switch"[^>]*>/)?.[0] ?? '';
// the attribute itself, not the `disabled:` class variant the switch also carries
const isDisabled = (html: string) => /\sdisabled(?=[\s>=])/.test(switchTag(html));

const detail = (data: Record<string, unknown>, form: unknown = null) =>
  render(Detail as never, { props: { data: { app, secret, signing: 'on', pending: [], pendingUnchecked: 0, impersonating: null, ...data }, form } } as never).body;

describe('the delete-after-use switch', () => {
  it('a reload with an open pending change and no form result still disables the switch', () => {
    expect(isDisabled(detail({ pending: [pending('SET_DELETE_AFTER_USE')] }, null))).toBe(true);
  });

  it('off: one switch, labelled for what it does, unchecked, posting true', () => {
    const html = detail({});
    expect(html).toContain('data-testid="delete-after-use"');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
    expect(html).toContain('Delete after use');
    expect(html).toContain('name="deleteAfterUse" value="true"');
    // not disabled: nothing is waiting, so the switch can be pressed
    expect(switchTag(html)).not.toBe('');
    expect(isDisabled(html)).toBe(false);
  });

  it('on: checked, posting false', () => {
    const html = detail({ secret: { ...secret, deleteAfterUse: true } });
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
    expect(html).toContain('name="deleteAfterUse" value="false"');
  });

  it('staged: a waiting change is shown, the switch cannot be pressed again, and nothing says saved', () => {
    const html = detail({ pending: [pending('SET_DELETE_AFTER_USE')] }, { action: 'deleteAfterUse', staged: true });
    expect(html).toContain('data-testid="deleteAfterUse-staged"');
    expect(isDisabled(html)).toBe(true);
    expect(html).not.toContain('data-testid="deleteAfterUse-saved"');
  });

  it('an unprotected secret saves at once: Saved shows after a plain save', () => {
    const html = detail({ secret: { ...secret, protected: false, deleteAfterUse: true } }, { action: 'deleteAfterUse', ok: true });
    expect(html).toContain('data-testid="deleteAfterUse-saved"');
  });

  it('an impersonation session sees it read-only', () => {
    expect(isDisabled(detail({ impersonating: 'someone' }))).toBe(true);
  });
});

describe('the pending notice names the two new operations', () => {
  it('turning delete-after-use on', () => {
    expect(detail({ pending: [pending('SET_DELETE_AFTER_USE')] })).toContain('turning delete after use on');
  });
  it('turning delete-after-use off', () => {
    expect(detail({ pending: [pending('CLEAR_DELETE_AFTER_USE')] })).toContain('turning delete after use off');
  });
  it('the raw operation code is not shown, as for every operation', () => {
    const html = detail({ pending: [pending('SET_DELETE_AFTER_USE')] });
    expect(html).not.toMatch(/SET_DELETE_AFTER_USE/);
  });
});
