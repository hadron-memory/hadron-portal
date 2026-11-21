// portal#2135: the REAL App page (`/app/apps/[appId]/+page.svelte`) on its Keys
// tab, mounted in real Chromium by scripts/test-app-keys-layout.mjs. Synthetic
// data only: no server, no key is minted, no provider is called. The runner
// aliases `$app/*` to the recorder stubs, as the client test lane does.
import { mount, unmount, type ComponentProps } from 'svelte';
import Page from '../../../routes/app/apps/[appId]/+page.svelte';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { beginEnhanced } from '$lib/test/stubs/app-forms';

/** Preview strings as the server stores them: short, never a secret. */
export const PREVIEWS = ['hdr_app_3f…9c', 'hdr_app_a1…07', 'hdr_app_5e…d2'];

type PageData = ComponentProps<typeof Page>['data'];

export type KeysFixture = {
  /** A create-key validation/action error under the label input. */
  error?: boolean;
  /**
   * The manager-only scopes read: `ok` adds the Scopes column (the default),
   * `hidden` is a viewer who may not see it (no column, no note), `failed` is
   * a read that errored (no column, and the note saying so).
   */
  scopes?: 'ok' | 'hidden' | 'failed';
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
  // pageData() types its forms as a union of every form on the page, so the one
  // the Keys tab binds is narrowed here, and nothing else is cast.
  const base = data.createKeyForm as PageData['createKeyForm'];
  const createKeyForm: PageData['createKeyForm'] = opts.error
    ? { ...base, message: { type: 'error', text: 'Couldn’t generate a key. Try again.' } }
    : base;
  const grantedAt = '2026-10-02T09:00:00.000Z';
  const scopes = opts.scopes ?? 'ok';
  // Every prop this harness sets is checked against the page's own data type,
  // so a renamed or retyped one fails `pnpm check`. The shared fixture stands in
  // for the layout data (user, navigation, ...) and is not typed that far, so
  // the merged object is asserted once, below.
  const keysData = {
    initialTab: 'keys',
    createKeyForm,
    appKeys: { kind: 'ok', keys },
    keyScopes: scopes === 'ok'
      ? { kind: 'ok', byKey: { k0: [{ scope: 'attention:deliver', hostId: null, grantedAt }, { scope: 'host:operate', hostId: 'h-1', grantedAt }], k1: [], k2: [] } }
      : { kind: scopes },
  } satisfies Partial<PageData>;
  const props: ComponentProps<typeof Page> = { data: { ...data, ...keysData } as unknown as PageData, form: null };
  const component = mount(Page, { target, props });
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
