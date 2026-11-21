/**
 * portal#2380 — the secrets pages, rendered on the server: a staged change is shown as waiting
 * for a passkey signature (never "Saved"), links only to the server's page, and the protect
 * control is absent where the deployment does not sign.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', () => ({ page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/') }), () => {}) } }));
import Detail from './[secretId]/+page.svelte';
import List from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const secret = { id: 's1', ownerType: 'app', ownerId: 'app-1', name: 'stripe-key', kind: 'generic', protected: true, currentVersion: 2, metadata: null, createdAt: '2026-11-01T00:00:00Z', createdBy: 'u1', updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'u1' };
const LINK = 'https://hadron.example/secret-changes/r1';
const pending = { requestId: 'r1', secretId: 's1', ceremonyUrl: LINK, state: 'open', operation: 'STORE', expiresAt: '2026-11-21T01:00:00Z' };

const detail = (data: Record<string, unknown>, form: unknown = null) =>
  render(Detail as never, { props: { data: { app, secret, signing: 'on', pending: [], impersonating: null, ...data }, form } } as never).body;

describe('a staged edit (acceptance 1)', () => {
  it('shows the pending notice with the server link, and the form does not claim a save', () => {
    const html = detail({ pending: [pending] }, { action: 'update', staged: true });
    expect(html).toContain('data-testid="pending-change"');
    expect(html).toContain('Waiting for your passkey signature');
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-testid="update-staged"');
    expect(html).not.toContain('data-testid="update-saved"');
    expect(html).not.toContain('>Saved.<');
    expect(html).toContain('Withdraw');
  });
  it('an ended request shows its state with no link and no withdraw', () => {
    const html = detail({ pending: [{ ...pending, state: 'expired' }] });
    expect(html).toContain('Expired before it was signed');
    expect(html).not.toContain(LINK);
    expect(html).not.toContain('Withdraw');
  });
  it('a plain save says Saved', () => {
    expect(detail({}, { action: 'update', ok: true })).toContain('data-testid="update-saved"');
  });
});

describe('signing off (acceptance 3)', () => {
  it('hides the protect control on the secret page and the protected option on create', () => {
    for (const signing of ['off', 'unknown']) {
      expect(detail({ signing })).not.toContain('secret-protect-heading');
      const list = render(List as never, { props: { data: { app, secrets: { kind: 'ok', secrets: [], total: 0 }, signing, pending: [], impersonating: null }, form: null } } as never).body;
      expect(list).not.toContain('name="protected"');
    }
    expect(detail({ signing: 'on' })).toContain('secret-protect-heading');
  });
  it('offers Turn off on a protected secret and Turn on on an unprotected one', () => {
    expect(detail({})).toContain('Turn off');
    expect(detail({ secret: { ...secret, protected: false } })).toContain('Turn on');
  });
});

describe('the list', () => {
  it('is the shared table, names link to the secret, and no value is ever shown', () => {
    const html = render(List as never, { props: { data: { app, secrets: { kind: 'ok', secrets: [secret], total: 1 }, signing: 'on', pending: [], impersonating: null }, form: null } } as never).body;
    expect(html).toContain('href="/app/apps/app-1/secrets/s1"');
    expect(html).toContain('stripe-key');
    expect(html).toContain('Protected');
  });
});
