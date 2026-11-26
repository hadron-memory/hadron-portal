/**
 * portal#2380 — the Secrets section of Settings, rendered on the server: a staged create is shown as waiting for a
 * passkey signature, names link to the secret, and the protect option is absent where the deployment does not sign.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
import Section from './AppSecrets.svelte';

const secret = { id: 's1', ownerType: 'app', ownerId: 'app-1', name: 'stripe-key', kind: 'generic', protected: true, currentVersion: 2, metadata: null, createdAt: '2026-11-01T00:00:00Z', createdBy: 'u1', updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'u1' };
const LINK = 'https://hadron.example/secret-changes/r1';
const pending = { requestId: 'r1', secretId: 's1', ceremonyUrl: LINK, state: 'open', operation: 'STORE', expiresAt: '2026-11-21T01:00:00Z' };
const panel = (extra: Record<string, unknown> = {}) => ({ secrets: { kind: 'ok', secrets: [secret], total: 1 }, signing: 'on', pending: [], pendingUnchecked: 0, impersonating: null, ...extra });
const html = (p: Record<string, unknown> = {}, form: unknown = null) => render(Section as never, { props: { appId: 'app-1', panel: panel(p), form } } as never).body;
const nameTag = (h: string) => h.match(/<input\b[^>]*\bid="secret-name"[^>]*>/)?.[0] ?? '';

describe('the list', () => {
  it('is the shared table, names link to the secret, and no value is ever shown', () => {
    const h = html();
    expect(h).toContain('href="/app/apps/app-1/secrets/s1"');
    expect(h).toContain('stripe-key');
    expect(h).toContain('Protected');
  });
  it('says so when the read failed, and when there are none', () => {
    expect(html({ secrets: { kind: 'failed' } })).toContain("couldn't be loaded");
    expect(html({ secrets: { kind: 'ok', secrets: [], total: 0 } })).toContain('data-testid="secrets-empty"');
  });
});

describe('signing off', () => {
  it('hides the protected option on create unless the deployment signs', () => {
    for (const signing of ['off', 'unknown']) expect(html({ signing })).not.toContain('name="protected"');
    expect(html({ signing: 'on' })).toContain('name="protected"');
  });
});

describe('the answers to the section\'s own actions', () => {
  it('a staged create clears the name field and says it waits for the signature', () => {
    const h = html({}, { action: 'createSecret', staged: true, name: 'new-key' });
    expect(nameTag(h)).not.toContain('new-key');
    expect(h).toContain('data-testid="create-staged"');
  });
  it('a successful create clears the name field', () => {
    expect(nameTag(html({}, { action: 'createSecret', ok: true, name: 'new-key' }))).not.toContain('new-key');
  });
  it('a refused create keeps the typed name so it can be corrected', () => {
    const h = html({}, { action: 'createSecret', name: 'Bad Name', message: 'Use lowercase letters.' });
    expect(nameTag(h)).toContain('Bad Name');
    expect(h).toContain('data-testid="create-error"');
  });
  it('a refused withdraw says so instead of leaving the pending row silent', () => {
    const h = html({ pending: [pending] }, { action: 'withdrawSecret', message: 'Too late to withdraw.' });
    expect(h).toContain('data-testid="withdraw-error"');
    expect(h).toContain('Too late to withdraw.');
  });
  it("another action's result is not shown here", () => {
    const h = html({}, { action: 'createKey', name: 'x', message: 'Nope.' });
    expect(h).not.toContain('data-testid="create-error"');
    expect(nameTag(h)).not.toContain('value="x"');
  });
});

describe('the pending notices', () => {
  it('names the secret a staged create asked for, from the tracked create', () => {
    const h = html({ pending: [{ ...pending, secretId: null, createName: 'new:key', operation: 'CREATE' }] });
    expect(h).toContain('new:key');
    expect(h).toContain('creating this secret');
  });
  it('a declined request reads as Declined, not as its raw state', () => {
    expect(html({ pending: [{ ...pending, state: 'declined' }] })).toContain('>Declined<');
  });
  it('says so when a waiting request could not be checked, and names the number', () => {
    const noted = html({ pendingUnchecked: 1 });
    expect(noted).toContain('data-testid="pending-unread"');
    expect(noted).toMatch(/check a change request/);
    expect(html({ pendingUnchecked: 3 })).toMatch(/Couldn.{1,8}t check 3 change requests/);
    expect(html()).not.toContain('data-testid="pending-unread"');
  });
  // Without JavaScript the answer renders the page: the action URL must name the section so it opens and loads.
  it('the create and withdraw forms post to the App page\'s actions, naming the Settings section', () => {
    expect(html({ pending: [pending] })).toContain('action="/app/apps/app-1?tab=settings&amp;section=secrets&amp;/withdrawSecret"');
    expect(html()).toContain('action="/app/apps/app-1?tab=settings&amp;section=secrets&amp;/createSecret"');
  });
});

describe('the copy says what the user can or must do', () => {
  it('the empty state names the next step', () => {
    expect(html({ secrets: { kind: 'ok', secrets: [], total: 0 } })).toContain('Add one below');
  });
  it('the passkey option says what it means for later changes, in helper text it is described by', () => {
    const h = html();
    expect(h).toContain('aria-describedby="secret-protected-help"');
    expect(h).toMatch(/id="secret-protected-help"[^>]*>[^<]*waits until you approve it with your passkey/);
  });
});
