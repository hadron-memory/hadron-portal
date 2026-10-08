/**
 * #864 / @copilot on #867 — the skill-export section must RE-SEED when the node
 * changes under a reused component.
 *
 * #1031: written against the retired `/edit` page; it now drives the same form
 * on the node page's Properties tab, through `NodeStorageForm.harness.svelte`.
 * Where it says "this page" below, read "this form".
 *
 * CLIENT lane, and it has to be: the defect lives entirely in the component
 * lifecycle. SvelteKit reuses this page across /nodes/A/edit → /nodes/B/edit,
 * and the split state (`declaration`, `restJson`) is seeded ONCE with
 * `untrack`. Left unreset it holds A's declaration while the form posts to B —
 * so Save writes one node's export declaration onto another, with nothing on
 * screen looking wrong.
 *
 * A server render never mounts, so the `node` lane cannot see any of this.
 *
 * ## What this harness does and does NOT prove
 *
 * Swapping `props.data` is not a real navigation. Measured: superForm does NOT
 * re-seed here (the name field keeps node A's value), while in the running app
 * it DOES — a router navigation invalidates and superForm syncs from the new
 * page data, which a bare prop swap never triggers.
 *
 * So these cases prove exactly one thing: the state THIS PAGE owns re-seeds.
 * The superForm half is covered by a browser measurement rather than by this
 * file, and saying so beats a test whose name implies more than it checks —
 * @copilot read the same code and concluded the name leaks too, which is true
 * of this harness and false of the app.
 *
 * This is the THIRD time this trap has been hit in this repo: #857 wrote one
 * worker's prompt override onto another the same way, which is why
 * `hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form`
 * exists. Measured here before the fix: declaring an export named
 * LEAK-CANARY on node A and navigating to node B left the canary in B's form.
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

function node(id: string, properties: Record<string, unknown> | null) {
  return {
    id,
    memoryId: 'mem-1',
    loc: id,
    name: id,
    nodeType: 'info',
    alias: null,
    description: null,
    abstract: null,
    content: '',
    seq: null,
    tags: [],
    data: null,
    ownerRepo: null,
    objectType: null,
    isRunnable: true,
    properties,
    outgoingEdges: [],
    incomingEdges: [],
    createdAt: '',
    updatedAt: '',
  };
}

async function dataFor(n: ReturnType<typeof node>) {
  return {
    node: n,
    graph: { id: 'mem-1', schema: null, urn: 'hrn:mem:x:m', name: 'M' },
    form: await superValidate(
      {
        isRunnable: true,
        objectType: '',
        propertiesJson: n.properties != null ? JSON.stringify(n.properties, null, 2) : '',
      },
      zod4(nodeStorageSchema),
      { errors: false },
    ),
  };
}

const declOf = (name: string) => ({
  exports: { claudeSkill: { name, description: 'd', enable: true } },
});

function exportNameBox(target: HTMLElement): HTMLInputElement | null {
  return target.querySelector('input#skill-export-name');
}

beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/memories/mem-1/nodes/a?tab=properties', { id: 'mem-1', nodeId: 'a' });
});

describe('the export section re-seeds when the node changes', () => {
  it('does not carry node A’s declaration onto node B', async () => {
    const props = reactiveProps({ data: await dataFor(node('a', declOf('LEAK-CANARY'))) });
    const mounted = mountComponent(Page as never, props as never);
    try {
      expect(exportNameBox(mounted.target)?.value).toBe('LEAK-CANARY');

      // The navigation: same route, new params, SAME component instance.
      props.data = await dataFor(node('b', null));
      flushSync();

      // B has no declaration, so the section reports "absent" — and above all
      // the canary must be gone. Before the fix it was still in the field.
      expect(exportNameBox(mounted.target)?.value ?? null).not.toBe('LEAK-CANARY');
    } finally {
      mounted.unmount();
    }
  });

  it('seeds node B’s OWN declaration, not merely a blank', async () => {
    // Clearing on navigation would hide the leak without fixing it: the next
    // node's real declaration has to appear.
    const props = reactiveProps({ data: await dataFor(node('a', declOf('from-a'))) });
    const mounted = mountComponent(Page as never, props as never);
    try {
      props.data = await dataFor(node('b', declOf('from-b')));
      flushSync();
      expect(exportNameBox(mounted.target)?.value).toBe('from-b');
    } finally {
      mounted.unmount();
    }
  });
});

describe('a properties value this form cannot split is preserved', () => {
  it.each([
    ['an array', '[1, 2]'],
    ['a scalar', '42'],
    ['a JSON null', 'null'],
    ['unparseable text', '{not json'],
  ])('keeps %s in the form rather than dropping it', async (_what, raw) => {
    // `JSON.parse` succeeds for the first three, and treating one as a bag
    // turned it into {} — the recombination effect then wrote an empty string,
    // so merely OPENING the node discarded a value the server may accept
    // (@copilot on #867).
    const d = await dataFor(node('a', null));
    (d.form.data as Record<string, unknown>).propertiesJson = raw;
    const props = reactiveProps({ data: d });
    const mounted = mountComponent(Page as never, props as never);
    try {
      flushSync();
      const submitted = (mounted.target.querySelector('input[name=propertiesJson]') as HTMLInputElement)?.value;
      expect(submitted).toBe(raw);
    } finally {
      mounted.unmount();
    }
  });
});
