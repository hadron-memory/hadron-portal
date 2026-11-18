// portal#2135: the REAL App page (`/app/apps/[appId]/+page.svelte`) on its Keys
// tab, mounted in real Chromium by scripts/test-app-keys-layout.mjs. Synthetic
// data only: no server, no key is minted, no provider is called. The runner
// aliases `$app/*` to the recorder stubs, as the client test lane does.
import { mount, unmount } from 'svelte';
import Page from '../../../routes/app/apps/[appId]/+page.svelte';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { beginEnhanced } from '$lib/test/stubs/app-forms';

/** Preview strings as the server stores them: short, never a secret. */
export const PREVIEWS = ['hdr_app_3f…9c', 'hdr_app_a1…07', 'hdr_app_5e…d2'];

export type KeysFixture = {
  /** A create-key validation/action error under the label input. */
  error?: boolean;
  /** Whether the manager-only scopes read answered (adds the Scopes column). */
  scopes?: boolean;
};

export async function mountAppKeys(target: HTMLElement, opts: KeysFixture = {}) {
  setStubPage('https://example.test/app/apps/a1?tab=keys', { appId: 'a1' });
  const data = await pageData();
  const keys = PREVIEWS.map((keyPreview, i) => ({
    id: `k${i}`,
    label: i === 0 ? 'production-backend-router' : `key-${i}`,
    keyPreview,
    createdAt: '2026-10-01T12:00:00.000Z',
    lastUsedAt: i === 1 ? '2026-11-01T08:30:00.000Z' : null,
    revokedAt: null,
  }));
  const createKeyForm = opts.error
    ? { ...data.createKeyForm, message: { type: 'error', text: 'Couldn’t generate a key. Try again.' } }
    : data.createKeyForm;
  const keyScopes = opts.scopes === false
    ? { kind: 'hidden' }
    : { kind: 'ok', byKey: { k0: [{ scope: 'attention:deliver', hostId: null, grantedAt: 'x' }, { scope: 'host:operate', hostId: 'h-1', grantedAt: 'x' }], k1: [], k2: [] } };
  const component = mount(Page as never, {
    target,
    props: { data: { ...data, initialTab: 'keys', createKeyForm, appKeys: { kind: 'ok', keys }, keyScopes }, form: null } as never,
  });
  return () => unmount(component);
}

/**
 * Put the create form in its pending ("Generating...") state: superforms' own
 * submit callback runs, and the result is never delivered, so the button
 * stays disabled for as long as the measurement takes.
 */
export async function beginGenerating(form: HTMLFormElement) {
  await beginEnhanced(form);
}
