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
  render(Detail as never, { props: { data: { app, secret, signing: 'on', pending: [], pendingUnchecked: 0, impersonating: null, ...data }, form } } as never).body;

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

describe('a staged result that has since ended', () => {
  it('no longer says Not saved yet once the request is withdrawn', () => {
    const html = detail({ pending: [{ ...pending, state: 'withdrawn' }] }, { action: 'update', staged: true });
    expect(html).not.toContain('data-testid="update-staged"');
  });
  it('a staged create clears the name field', () => {
    const html = render(List as never, { props: { data: { app, secrets: { kind: 'ok', secrets: [secret], total: 1 }, signing: 'on', pending: [], impersonating: null }, form: { action: 'create', staged: true, name: 'new-key' } } } as never).body;
    // Read the whole input tag, so the check does not depend on the order its attributes are emitted in.
    const tag = html.match(/<input\b[^>]*\bid="secret-name"[^>]*>/)?.[0] ?? '';
    expect(tag).not.toBe('');
    expect(tag).not.toContain('new-key');
  });
});

describe('a refused withdraw on the list page', () => {
  it('says so instead of leaving the pending row silent', () => {
    const html = render(List as never, { props: { data: { app, secrets: { kind: 'ok', secrets: [secret], total: 1 }, signing: 'on', pending: [pending], impersonating: null }, form: { action: 'withdraw', message: 'Too late to withdraw.' } } } as never).body;
    expect(html).toContain('data-testid="withdraw-error"');
    expect(html).toContain('Too late to withdraw.');
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

describe('portal#2436 item 4: Delete asks before it deletes, with and without JavaScript', () => {
  it('the first Delete is a plain button; the confirmation, its Delete and its Cancel appear once the server asked', () => {
    const before = detail({});
    expect(before).not.toContain('data-testid="delete-confirm"');
    expect(before).not.toContain('name="confirm"');
    const asked = detail({}, { action: 'delete', confirm: true });
    expect(asked).toContain('data-testid="delete-confirm"');
    expect(asked).toContain('Delete stripe-key and every version of it?');
    expect(asked).toContain('name="confirm" value="yes"');
    expect(asked).toContain('href="/app/apps/app-1/secrets/s1"');
    expect(asked).toContain('>Cancel<');
  });
  it('another action\'s form data never opens the delete confirmation', () => {
    expect(detail({}, { action: 'update', ok: true })).not.toContain('data-testid="delete-confirm"');
  });
});

describe('portal#2436 item 1/2: the list notice for a staged create and a declined request', () => {
  const list = (p: Record<string, unknown>) => render(List as never, { props: { data: { app, secrets: { kind: 'ok', secrets: [secret], total: 1 }, signing: 'on', pending: [p], impersonating: null }, form: null } } as never).body;
  it('names the secret a staged create asked for, from the tracked create, not from a parsed string', () => {
    const html = list({ ...pending, secretId: null, createName: 'new:key', operation: 'CREATE' });
    expect(html).toContain('new:key');
    expect(html).toContain('creating this secret');
  });
  it('a declined request reads as Declined, not as its raw state', () => {
    expect(list({ ...pending, state: 'declined' })).toContain('>Declined<');
  });
});

describe('the secrets list after a create and after a failed read (portal#2436)', () => {
  const data = (extra: Record<string, unknown> = {}) => ({ app, secrets: { kind: 'ok', secrets: [secret], total: 1 }, signing: 'on', pending: [], pendingUnchecked: 0, impersonating: null, ...extra });
  const nameTag = (form: unknown, extra: Record<string, unknown> = {}) => {
    const html = render(List as never, { props: { data: data(extra), form } } as never).body;
    return html.match(/<input\b[^>]*\bid="secret-name"[^>]*>/)?.[0] ?? '';
  };
  it('a successful create clears the name field', () => {
    const tag = nameTag({ action: 'create', ok: true, name: 'new-key' });
    expect(tag).not.toBe('');
    expect(tag).not.toContain('new-key');
  });
  it('a refused create keeps the typed name so it can be corrected', () => {
    expect(nameTag({ action: 'create', name: 'Bad Name', message: 'Use lowercase letters.' })).toContain('Bad Name');
  });
  it('says so when a waiting request could not be checked, and stays quiet otherwise', () => {
    const noted = render(List as never, { props: { data: data({ pendingUnchecked: 1 }), form: null } } as never).body;
    expect(noted).toContain('data-testid="pending-unread"');
    expect(noted).toMatch(/Couldn.{1,8}t check/);
    const quiet = render(List as never, { props: { data: data(), form: null } } as never).body;
    expect(quiet).not.toContain('data-testid="pending-unread"');
  });
  // Kills: a notice that ignores the count (the singular sentence for any number).
  it('names the number when more than one waiting request could not be checked', () => {
    const html = render(List as never, { props: { data: data({ pendingUnchecked: 3 }), form: null } } as never).body;
    expect(html).toMatch(/Couldn.{1,8}t check 3 change requests/);
    expect(html).not.toMatch(/check a change request/);
    const one = render(List as never, { props: { data: data({ pendingUnchecked: 1 }), form: null } } as never).body;
    expect(one).toMatch(/check a change request/);
    expect(one).not.toMatch(/check 1 /);
  });
  it('the secret page says so too when a waiting request could not be checked', () => {
    expect(detail({ pendingUnchecked: 1 })).toContain('data-testid="pending-unread"');
    expect(detail({})).not.toContain('data-testid="pending-unread"');
  });
});
