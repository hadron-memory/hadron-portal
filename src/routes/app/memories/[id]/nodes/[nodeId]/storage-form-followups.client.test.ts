/**
 * Two defects Cody found in QA of #1035, both inherited from the retired
 * `/edit` page and fixed as its follow-ups.
 *
 * 1. On a memory with NO schema, Object type is free text, but the first
 *    character typed turned it into a <select>. The select is for a memory
 *    WITH a schema whose node still carries a pre-schema (undeclared) type.
 * 2. A failed save that arrives as a full page (no JS yet: a slow load, or a
 *    POST before hydration) lost its server error on hydration. On mount, the
 *    form re-wrote the bag it was handed in its own formatting, and the
 *    client-side validation that write set off replaced the server's verdict,
 *    re-enabling Save beside a value the server had just refused.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import Page from './NodeStorageForm.harness.svelte';
import { NODE_STORAGE_FORM_ID, nodeStorageSchema } from './storage-schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

const SCHEMA = { objectTypes: { competitor: { strict: true, fields: { name: { type: 'text' } } } } };

function node(over: Record<string, unknown> = {}) {
  return {
    id: 'n1', memoryId: 'mem-1', loc: 'n1', name: 'N1', nodeType: 'info', alias: null,
    description: null, abstract: null, content: '', seq: null, tags: [], data: null,
    ownerRepo: null, objectType: null, isRunnable: false, properties: null,
    outgoingEdges: [], incomingEdges: [], createdAt: '', updatedAt: '',
    ...over,
  };
}

async function seedFor(n: ReturnType<typeof node>) {
  return superValidate(
    {
      isRunnable: n.isRunnable,
      objectType: (n.objectType as string | null) ?? '',
      propertiesJson: n.properties != null ? JSON.stringify(n.properties, null, 2) : '',
    },
    zod4(nodeStorageSchema),
    { errors: false, id: NODE_STORAGE_FORM_ID },
  );
}

async function mount(n: ReturnType<typeof node>, schema: unknown, form: unknown = null) {
  setStubPage('https://example.test/app/memories/mem-1/nodes/n1?tab=properties', { id: 'mem-1', nodeId: 'n1' });
  // A full-page POST renders with the action result on the page store too.
  if (form) page.update((p) => ({ ...p, status: 400, form }));
  const m = mountComponent(Page as never, {
    data: { node: n, graph: { id: 'mem-1', schema, urn: 'hrn:mem:x:m', name: 'M' }, form: await seedFor(n) },
    form,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  flushSync();
  return m.target;
}

describe('Object type control (#1035 QA follow-up 1)', () => {
  it('stays a text input on a memory with no schema while the reader types', async () => {
    const target = await mount(node(), null);
    const input = target.querySelector<HTMLInputElement>('input#objectType');
    expect(input).not.toBeNull();
    input!.value = 'c';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('select#objectType')).toBeNull();
    expect(target.querySelector<HTMLInputElement>('input#objectType')?.value).toBe('c');
  });

  it('is a picker on a memory with a schema, keeping a stored pre-schema type selectable', async () => {
    const target = await mount(node({ objectType: 'legacy-thing' }), SCHEMA);
    const select = target.querySelector<HTMLSelectElement>('select#objectType');
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((o) => o.value)).toEqual(['', 'competitor', 'legacy-thing']);
  });

  it('is free text on a memory with no schema even when the node carries a type', async () => {
    const target = await mount(node({ objectType: 'thing' }), null);
    expect(target.querySelector<HTMLInputElement>('input#objectType')?.value).toBe('thing');
  });
});

describe('a full-page failed save keeps its server error (#1035 QA follow-up 2)', () => {
  async function failed(propertiesJson: string, error: string) {
    const f = await superValidate(
      { isRunnable: false, objectType: 'competitor', propertiesJson },
      zod4(nodeStorageSchema),
      { id: NODE_STORAGE_FORM_ID },
    );
    f.valid = false;
    f.posted = true;
    f.errors = { propertiesJson: [error] };
    return { form: f };
  }

  it('shows the refusal, and Save stays disabled, after hydration', async () => {
    // Posted compact, as the browser sends whatever the hidden input held.
    const target = await mount(
      node({ objectType: 'competitor', properties: { name: 'Acme' } }),
      SCHEMA,
      await failed('{"name":"Acme","extra":1}', 'Unknown property "extra" for strict object type "competitor"'),
    );
    // superforms validates a programmatic store change asynchronously (an async
    // schema parse, then a tick), so give it time to land before asserting.
    await new Promise((r) => setTimeout(r, 50));
    await tick(2);
    flushSync();
    expect(target.textContent).toContain('Unknown property "extra"');
    const save = Array.from(target.querySelectorAll('button[type=submit]')).find((b) => b.textContent?.trim() === 'Save');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // And the section holding it is open, so the error is not inside a closed <details>.
    const error = Array.from(target.querySelectorAll('p')).find((p) => p.textContent?.includes('Unknown property'));
    expect(error!.closest('details')!.open).toBe(true);
  });
});

describe('"Saved." follows the form, not only its typed inputs (Cody on #1035)', () => {
  it('clears when a BUTTON edits the form after a save', async () => {
    const OPEN = { objectTypes: { competitor: { strict: false, fields: { name: { type: 'text' } } } } };
    const n = node({ objectType: 'competitor', properties: { name: 'Acme', extra: 1 } });
    const target = await mount(n, OPEN);
    const result = await superValidate(
      { isRunnable: false, objectType: 'competitor', propertiesJson: JSON.stringify(n.properties) },
      zod4(nodeStorageSchema),
      { id: NODE_STORAGE_FORM_ID },
    );
    result.message = { type: 'success', text: 'Saved.' };
    page.update((p) => ({ ...p, status: 200, form: { form: result } }));
    flushSync();
    await tick(3);
    expect(target.textContent).toContain('Saved.');

    // "Remove property" is a button: it fires no input or change event.
    const remove = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === '×');
    expect(remove).toBeDefined();
    remove!.click();
    flushSync();
    await tick(2);
    expect(target.textContent).not.toContain('Saved.');
  });
});

describe('"Saved." is about content, not text (Cody on #1042)', () => {
  it('stays through a whitespace-only change to the raw properties, and clears on a real one', async () => {
    // A reformat is not an edit: the saved content is still what the form
    // holds. (The re-seed never reformats a saved bag on its own: it keys on
    // canonical content, so a reload returning the same bag does not re-seed.
    // Whitespace typed into the raw editor is the reachable case.)
    const n = node({ properties: { color: 'green' } });
    const target = await mount(n, null);
    const result = await superValidate(
      { isRunnable: false, objectType: '', propertiesJson: JSON.stringify(n.properties, null, 2) },
      zod4(nodeStorageSchema),
      { id: NODE_STORAGE_FORM_ID },
    );
    result.message = { type: 'success', text: 'Saved.' };
    page.update((p) => ({ ...p, status: 200, form: { form: result } }));
    flushSync();
    await tick(3);
    expect(target.textContent).toContain('Saved.');

    const raw = target.querySelector<HTMLTextAreaElement>('textarea#properties')!;
    raw.value = '{ "color":   "green" }\n';
    raw.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick(2);
    expect(target.textContent).toContain('Saved.');

    raw.value = '{ "color": "blue" }';
    raw.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick(2);
    expect(target.textContent).not.toContain('Saved.');
  });
});
