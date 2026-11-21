/**
 * portal#2376 (slice 3 of #2344): the signing preview page's two notes ("couldn't load", "this isn't
 * available") share a region that is mounted before either speaks. Before/during/after: the region
 * EXISTS and is EMPTY while the preview shows, holds the note, and is the SAME element when it clears.
 *
 * "This isn't available" (ambiguous): it is the answer to a switch-on the caller lost the audience for, so
 * it arrives after a user action while the page is open: a polite status like every sibling note here, and
 * deliberately worded to say nothing about the org, so it is not an alert.
 */
import { afterEach, describe, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const org = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' };
const sw = { kind: 'ok', required: false, enforced: false, deploymentSigns: true };
const preview = { kind: 'ok', enforced: false, deploymentSigns: true, total: 0, rows: [], previewToken: 'tok' };

async function open() {
  setStubPage('http://localhost/app/orgs/org-1/boot-prompt-signing');
  const props = reactiveProps<Record<string, unknown>>({ data: { org, sw, preview }, form: null });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const set = (data: Record<string, unknown>, form: unknown = null) => () => { props.data = { org, sw, preview, ...data }; props.form = form; };
  return { root: mounted.target, set };
}

describe('signing preview page: the notes are in a persistent status region', () => {
  it('"Couldn’t load boot prompt signing.": empty, then text, then the same element', async () => {
    const { root, set } = await open();
    await expectRegionLifecycle(root, 'Couldn’t load boot prompt signing.', set({ sw: { kind: 'failed' } }), set({}), () => tick());
  });

  it('"This isn’t available.": empty, then text, then the same element', async () => {
    const { root, set } = await open();
    await expectRegionLifecycle(root, 'This isn’t available.', set({}, { outcome: 'hidden' }), set({}), () => tick());
  });
});
