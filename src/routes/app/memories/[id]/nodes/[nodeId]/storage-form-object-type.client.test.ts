/**
 * #1040 — on a schema-less memory, Object type stays a free-text input while
 * the user types it.
 *
 * The picker's `(not declared)` arm exists for a pre-schema value a SCHEMA'D
 * memory no longer declares. Letting it choose the branch on a schema-less
 * memory, where every value is undeclared, swapped the input for a `<select>`
 * on the first keystroke.
 *
 * CLIENT lane because the defect is a bound value re-deciding an `{#if}`
 * after an input event, which a server render never runs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { nodeStorageSchema } from './storage-schema';
import Page from './NodeStorageForm.harness.svelte';

async function mountPage(seed: { objectType?: string; schema?: Record<string, unknown> | null }) {
  const node = {
    id: 'n1',
    memoryId: 'mem-1',
    loc: 'gadgets:one',
    name: 'One',
    nodeType: 'data',
    alias: null,
    description: null,
    abstract: null,
    content: null,
    seq: null,
    tags: [],
    data: null,
    ownerRepo: null,
    objectType: seed.objectType ?? null,
    isRunnable: false,
    properties: null,
    outgoingEdges: [],
    incomingEdges: [],
    createdAt: '',
    updatedAt: '',
  };
  const form = await superValidate(
    { isRunnable: false, objectType: seed.objectType ?? '', propertiesJson: '' },
    zod4(nodeStorageSchema),
    { errors: false },
  );
  const data = {
    node,
    graph: { id: 'mem-1', schema: seed.schema ?? null, urn: 'hrn:mem:x:m', name: 'M' },
    form,
  };
  return mountComponent(Page as never, reactiveProps({ data }) as never);
}

const objectTypeField = (target: HTMLElement) => target.querySelector('#objectType') as HTMLElement;

function type(field: HTMLElement, value: string) {
  (field as HTMLInputElement).value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/memories/mem-1/nodes/n1?tab=properties', { id: 'mem-1', nodeId: 'n1' });
});

describe('schema-less memory', () => {
  it('keeps the free-text input through every keystroke', async () => {
    const m = await mountPage({});
    try {
      expect(objectTypeField(m.target).tagName).toBe('INPUT');
      for (const prefix of ['g', 'ga', 'gadget']) {
        type(objectTypeField(m.target), prefix);
        const field = objectTypeField(m.target);
        expect(field.tagName).toBe('INPUT');
        expect((field as HTMLInputElement).value).toBe(prefix);
      }
      expect(m.target.querySelector('select#objectType')).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('shows a stored object type in the free-text input, not a picker', async () => {
    const m = await mountPage({ objectType: 'gadget' });
    try {
      const field = objectTypeField(m.target);
      expect(field.tagName).toBe('INPUT');
      expect((field as HTMLInputElement).value).toBe('gadget');
    } finally {
      m.unmount();
    }
  });
});

describe('schema’d memory', () => {
  const schema = { objectTypes: { competitor: { fields: { stage: { type: 'text' } } } } };

  it('is a picker over the declared collections', async () => {
    const m = await mountPage({ schema });
    try {
      const field = objectTypeField(m.target);
      expect(field.tagName).toBe('SELECT');
      const values = Array.from((field as HTMLSelectElement).options).map((o) => o.value);
      expect(values).toEqual(['', 'competitor']);
    } finally {
      m.unmount();
    }
  });

  it('keeps a pre-schema value selectable, marked not declared', async () => {
    const m = await mountPage({ schema, objectType: 'legacy' });
    try {
      const field = objectTypeField(m.target) as HTMLSelectElement;
      expect(field.tagName).toBe('SELECT');
      const legacy = Array.from(field.options).find((o) => o.value === 'legacy');
      expect(legacy?.textContent).toContain('(not declared)');
      expect(field.value).toBe('legacy');
    } finally {
      m.unmount();
    }
  });
});
