/**
 * #886 / @codex on #893 — the Properties Source draft must survive an
 * UNRELATED reload. Saving Content, Abstract or Data calls invalidateAll(),
 * which hands the page a new node object with the same properties; the first
 * version re-seeded on that and silently discarded an unsaved Source edit.
 *
 * CLIENT lane because the defect lived in an effect, which a server render
 * never runs. The harness mounts the page's own `syncDraftWith`; the node prop
 * is reassigned the way a reload or a navigation reassigns it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { PropertiesDraft, submitPropertiesDraft, type DraftNode } from './properties-draft.svelte';
import { propertiesFingerprint } from './properties-source';
import Harness from './test/PropertiesDraftHarness.svelte';

type Props = { draft: PropertiesDraft; node: DraftNode };
const mounted: Array<Mounted<Props>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function setup(node: DraftNode) {
  const props = reactiveProps<Props>({ draft: new PropertiesDraft(), node });
  const m = mountComponent(Harness, props);
  mounted.push(m);
  await tick();
  return { props, draft: props.draft, m };
}

const bag = { url: 'https://x', exports: { claudeSkill: { enable: true } } };

describe('PropertiesDraft through the page effect', () => {
  it('seeds from the node, and an empty bag opens on {}', async () => {
    const { draft } = await setup({ id: 'a', properties: bag });
    expect(JSON.parse(draft.text)).toEqual(bag);
    expect(draft.dirty).toBe(false);
    const empty = await setup({ id: 'b', properties: null });
    expect(empty.draft.text).toBe('{}');
  });

  it('KEEPS an unsaved edit across an unrelated reload — a new node object, the same bag', async () => {
    const { props, draft } = await setup({ id: 'a', properties: bag });
    draft.text = '{"url": "edited"}';
    // What invalidateAll() does after a Content save: a fresh object, same data.
    props.node = { id: 'a', properties: structuredClone(bag) };
    await tick();
    expect(draft.text).toBe('{"url": "edited"}');
    expect(draft.dirty).toBe(true);
  });

  it('a key-order-only difference is still the same bag', async () => {
    const { props, draft } = await setup({ id: 'a', properties: bag });
    draft.text = '{"edited": true}';
    props.node = { id: 'a', properties: { exports: bag.exports, url: bag.url } };
    await tick();
    expect(draft.text).toBe('{"edited": true}');
  });

  it('a CHANGED bag under a dirty draft keeps the draft AND its baseline — the save\'s stale check then refuses it', async () => {
    const { props, draft } = await setup({ id: 'a', properties: bag });
    draft.text = '{"mine": 1}';
    props.node = { id: 'a', properties: { ...bag, theirs: 2 } };
    await tick();
    expect(draft.text).toBe('{"mine": 1}');
    expect(draft.baseline).toEqual(bag);
  });

  it('a changed bag under a CLEAN draft shows the new bag', async () => {
    const { props, draft } = await setup({ id: 'a', properties: bag });
    props.node = { id: 'a', properties: { ...bag, theirs: 2 } };
    await tick();
    expect(JSON.parse(draft.text)).toEqual({ ...bag, theirs: 2 });
    expect(draft.baseline).toEqual({ ...bag, theirs: 2 });
  });

  it('a different NODE always re-seeds, dirty or not (#251: the page is reused across nodes)', async () => {
    const { props, draft } = await setup({ id: 'a', properties: bag });
    draft.text = '{"for": "node a"}';
    props.node = { id: 'b', properties: { other: true } };
    await tick();
    expect(JSON.parse(draft.text)).toEqual({ other: true });
    expect(draft.dirty).toBe(false);
  });

  it('reseed() after our own save starts over, even though the draft was dirty', async () => {
    const { draft } = await setup({ id: 'a', properties: bag });
    draft.text = '{"saved": 1}';
    draft.reseed({ id: 'a', properties: { saved: 1 } });
    expect(draft.dirty).toBe(false);
    expect(draft.baseline).toEqual({ saved: 1 });
  });

  it('stops syncing once unmounted', async () => {
    const { props, draft, m } = await setup({ id: 'a', properties: bag });
    m.unmount();
    props.node = { id: 'b', properties: { other: true } };
    await tick();
    expect(JSON.parse(draft.text)).toEqual(bag);
  });
});

describe('a deeply nested STORED bag (@codex on #893)', () => {
  // Plain props here, NOT reactiveProps: a $state proxy adds stack frames per
  // level, and a real page's `node.properties` is a plain object. Built twice
  // rather than structuredClone'd, which itself overflows at this depth.
  const deep = (n: number) => {
    let v: unknown = 1;
    for (let k = 0; k < n; k++) v = { a: v };
    return v as Record<string, unknown>;
  };

  it('mounts and syncs a 3,000-level bag without a stack overflow — the depth limit only guards what is TYPED', async () => {
    const draft = new PropertiesDraft();
    const m = mountComponent(Harness, { draft, node: { id: 'deep', properties: deep(3000) } });
    mounted.push(m as Mounted<Props>);
    await tick();
    expect(draft.dirty).toBe(false);
    expect(draft.text.length).toBeGreaterThan(3000);
    // The same bag rebuilt — an unrelated reload — is recognised as the same.
    draft.text = '{"edited": true}';
    draft.sync({ id: 'deep', properties: deep(3000) });
    expect(draft.text).toBe('{"edited": true}');
  });
});

describe('submitPropertiesDraft — one save, bound to where it started (@codex on #893)', () => {
  function recorder(result: unknown) {
    const calls: Array<{ url: string; body: FormData }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as FormData });
      return new Response(JSON.stringify(result));
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('posts to the URL it was GIVEN — the originating node — with the captured text and a fingerprint', async () => {
    const { calls, fetchImpl } = recorder({ type: 'success', status: 200 });
    const url = '/app/memories/m/nodes/node-a?/updateProperties';
    const out = await submitPropertiesDraft({ url, text: '{"a":1}', baseline: { x: 1 }, fetchImpl });
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(url);
    expect(calls[0].body.get('properties')).toBe('{"a":1}');
    expect(calls[0].body.get('baseline')).toBe(await propertiesFingerprint({ x: 1 }));
  });

  it('returns a refusal as data — code and the server\'s detail — not as an exception', async () => {
    const { fetchImpl } = recorder({
      type: 'failure',
      status: 400,
      data: { propertiesFailed: { code: 'rejected', detail: 'strict collection' } },
    });
    expect(await submitPropertiesDraft({ url: '/x?/updateProperties', text: '{}', baseline: null, fetchImpl })).toEqual({
      ok: false,
      code: 'rejected',
      detail: 'strict collection',
    });
  });
});
