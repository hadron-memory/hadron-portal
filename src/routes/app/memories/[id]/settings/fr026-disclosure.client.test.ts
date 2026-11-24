/**
 * #2533: the FR-026 disclosure the portal shows before an encrypted memory's
 * vector index is enabled must carry the server's current four points
 * (hadron-server src/lib/entityRef/errors.ts, FR_026_DISCLOSURE), including
 * that the verbatim passage text is stored unencrypted. hrn:node:hadronmemory.com:specs:cor:rag:010:01 binds
 * the wording; hrn:node:hadronmemory.com:specs:cor:sec:040:05 names the vector-indexing row.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';
import Page from './+page.svelte';

/** Verbatim copy of hadron-server FR_026_DISCLOSURE (server main after #433). */
const SERVER_DISCLOSURE = [
  '(a) Stored vectors are plaintext — they are NOT encrypted at rest the way the content column is.',
  '(b) When the index includes content passages (embeddingSource contentChunks or both), the verbatim text of each indexed chunk is ALSO stored UNENCRYPTED, in node_embeddings.chunk_text next to its vector: a database dump holds that text in full, readable form. Embedding inversion can additionally reconstruct source text, partially, from a vector alone.',
  '(c) Anyone with database access is therefore a potential viewer of that text (the full text of every indexed chunk, and whatever inversion recovers from the vectors), even though the content column itself is encrypted.',
  "(d) The opt-in is revocable; revoking stops further indexing AND removes the memory's already-stored vectors and their chunk text.",
];

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function renderEncrypted() {
  const graph = settingsGraph({ vectorIndexEnabled: false, isEncrypted: true });
  const forms = await settingsForms(graph, false);
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph, user: OWNER, ownerUserId: OWNER_ID, owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
      org: { id: 'org-1', members: [{ user: { id: OWNER.id }, role: 'ADMIN' }] },
      allOrgs: [], transferCanDelete: false, canWriteMemory: true, canManageMemory: true, ...forms,
    } as never,
    form: null as never,
  });
  setStubPage('http://localhost/app/memories/mem-1/settings', { id: 'mem-1' });
  page.update((p) => ({ ...p, data: props.data as Record<string, unknown> }));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m;
}

describe('FR-026 disclosure copy (#2533)', () => {
  it('the pre-enable note does not say only vectors are exposed', async () => {
    const { target } = await renderEncrypted();
    const text = target.textContent ?? '';
    expect(text).toContain('This memory is encrypted');
    expect(text).not.toContain('stored vectors are plaintext (see disclosure on save)');
    expect(text).toMatch(/passage text/i);
  });

  it('shows the server four points verbatim when the acknowledgement is asked for', async () => {
    const { target } = await renderEncrypted();
    const box = target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const save = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('Save vector index settings'))!;
    save.click();
    await tick();
    const items = [...target.querySelectorAll('li')].map((li) => li.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(SERVER_DISCLOSURE));
    expect(target.textContent).not.toContain('partial content');
  });
});
