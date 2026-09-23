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
import { displayJson, JsonDraft, submitJsonDraft, type DraftSource } from './json-draft.svelte';
import { parsePropertiesSource, PROPERTIES_MAX, propertiesFingerprint, utf8Length } from './properties-source';
import Harness from './test/JsonDraftHarness.svelte';

type Props = { draft: JsonDraft; node: DraftSource };
const mounted: Array<Mounted<Props>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

/** Mount through the page's own effect, then OPEN Source — the page seeds on open. */
async function setup(node: DraftSource) {
  const props = reactiveProps<Props>({ draft: new JsonDraft('{}'), node });
  const m = mountComponent(Harness, props);
  mounted.push(m);
  await tick();
  props.draft.ensureSeeded();
  return { props, draft: props.draft, m };
}

const bag = { url: 'https://x', exports: { claudeSkill: { enable: true } } };

describe('JsonDraft through the page effect', () => {
  it('seeds from the node, and an empty bag opens on {}', async () => {
    const { draft } = await setup({ id: 'a', value: bag });
    expect(JSON.parse(draft.text)).toEqual(bag);
    expect(draft.dirty).toBe(false);
    const empty = await setup({ id: 'b', value: null });
    expect(empty.draft.text).toBe('{}');
  });

  it('KEEPS an unsaved edit across an unrelated reload — a new node object, the same bag', async () => {
    const { props, draft } = await setup({ id: 'a', value: bag });
    draft.text = '{"url": "edited"}';
    // What invalidateAll() does after a Content save: a fresh object, same data.
    props.node = { id: 'a', value: structuredClone(bag) };
    await tick();
    expect(draft.text).toBe('{"url": "edited"}');
    expect(draft.dirty).toBe(true);
  });

  it('a key-order-only difference is still the same bag', async () => {
    const { props, draft } = await setup({ id: 'a', value: bag });
    draft.text = '{"edited": true}';
    props.node = { id: 'a', value: { exports: bag.exports, url: bag.url } };
    await tick();
    expect(draft.text).toBe('{"edited": true}');
  });

  it('a CHANGED bag under a dirty draft keeps the draft AND its baseline — the save\'s stale check then refuses it', async () => {
    const { props, draft } = await setup({ id: 'a', value: bag });
    draft.text = '{"mine": 1}';
    props.node = { id: 'a', value: { ...bag, theirs: 2 } };
    await tick();
    expect(draft.text).toBe('{"mine": 1}');
    expect(draft.baseline).toEqual(bag);
  });

  it('a changed bag under a CLEAN draft shows the new bag', async () => {
    const { props, draft } = await setup({ id: 'a', value: bag });
    props.node = { id: 'a', value: { ...bag, theirs: 2 } };
    await tick();
    expect(JSON.parse(draft.text)).toEqual({ ...bag, theirs: 2 });
    expect(draft.baseline).toEqual({ ...bag, theirs: 2 });
  });

  it('a different NODE always re-seeds, dirty or not (#251: the page is reused across nodes)', async () => {
    const { props, draft } = await setup({ id: 'a', value: bag });
    draft.text = '{"for": "node a"}';
    props.node = { id: 'b', value: { other: true } };
    await tick();
    // The page closes Source on a node change; reopening it seeds node b.
    expect(draft.dirty).toBe(false);
    draft.ensureSeeded();
    expect(JSON.parse(draft.text)).toEqual({ other: true });
  });

  it('reseed() after our own save starts over, even though the draft was dirty', async () => {
    const { draft } = await setup({ id: 'a', value: bag });
    draft.text = '{"saved": 1}';
    draft.reseed({ id: 'a', value: { saved: 1 } });
    expect(draft.dirty).toBe(false);
    expect(draft.baseline).toEqual({ saved: 1 });
  });

  it('stops syncing once unmounted', async () => {
    const { props, draft, m } = await setup({ id: 'a', value: bag });
    m.unmount();
    props.node = { id: 'b', value: { other: true } };
    await tick();
    expect(JSON.parse(draft.text)).toEqual(bag);
  });
});

describe('seeding is LAZY and never throws (@codex on #893)', () => {
  // Plain props here, NOT reactiveProps: a $state proxy adds stack frames per
  // level, and a real page's `node.properties` is a plain object. Built fresh
  // rather than structuredClone'd, which itself overflows at these depths.
  const deep = (n: number) => {
    let v: unknown = 1;
    for (let k = 0; k < n; k++) v = { a: v };
    return v as Record<string, unknown>;
  };
  function mountPlain(node: DraftSource) {
    const draft = new JsonDraft('{}');
    const m = mountComponent(Harness, { draft, node });
    mounted.push(m as unknown as Mounted<Props>);
    return draft;
  }

  it('mounting a node page serializes NOTHING — the text is built only when Source opens', async () => {
    const draft = mountPlain({ id: 'a', value: bag });
    await tick();
    expect(draft.text).toBe('');
    expect(draft.dirty).toBe(false);
    expect(draft.baseline).toEqual(bag);
    draft.ensureSeeded();
    expect(JSON.parse(draft.text)).toEqual(bag);
    draft.ensureSeeded(); // idempotent: does not overwrite typing
    expect(JSON.parse(draft.text)).toEqual(bag);
  });

  // Depths are chosen to hold on ANY V8 stack: a vitest worker's is smaller
  // than the main thread's, and where exactly JSON.stringify overflows is a
  // property of the runtime, not of this code. What is pinned is the
  // behaviour on each side of the line — compact below it, unavailable past it.
  it('a deep stored bag mounts without cost, and opens COMPACT when indenting would blow past the cap', async () => {
    // 500 levels: small compact, but indentation grows with depth — ~500 KB.
    expect(JSON.stringify(deep(500), null, 2).length).toBeGreaterThan(PROPERTIES_MAX);
    const draft = mountPlain({ id: 'deep', value: deep(500) });
    await tick();
    expect(draft.text).toBe('');
    draft.ensureSeeded();
    expect(draft.unavailable).toBe(false);
    expect(draft.text).not.toContain('\n');
    expect(draft.text.length).toBeLessThan(PROPERTIES_MAX);
    // …and the same bag rebuilt — an unrelated reload — keeps an edit.
    draft.text = '{"edited": true}';
    draft.sync({ id: 'deep', value: deep(500) });
    expect(draft.text).toBe('{"edited": true}');
  });

  it('chooses compact vs pretty by UTF-8 BYTES — a multibyte bag must not open on text its own validator refuses', async () => {
    // Built to fall between the two measures: compact ~119 KB, pretty ~299 KB
    // in bytes but only ~227K characters. Counted in characters, the pretty
    // form "fit" and the editor opened too large to save.
    let bag: unknown = { items: Array.from({ length: 3600 }, () => '語'.repeat(10)) };
    for (let k = 0; k < 23; k++) bag = { a: bag };
    const pretty = JSON.stringify(bag, null, 2);
    expect(utf8Length(JSON.stringify(bag))).toBeLessThanOrEqual(PROPERTIES_MAX / 2);
    expect(pretty.length).toBeLessThan(PROPERTIES_MAX);
    expect(utf8Length(pretty)).toBeGreaterThan(PROPERTIES_MAX);

    const draft = mountPlain({ id: 'mb', value: bag as Record<string, unknown> });
    await tick();
    draft.ensureSeeded();
    expect(utf8Length(draft.text)).toBeLessThanOrEqual(PROPERTIES_MAX);
    expect(parsePropertiesSource(draft.text).ok).toBe(true);
  });

  it('a bag too deep even for compact JSON is UNAVAILABLE, not a crash', async () => {
    const draft = mountPlain({ id: 'deeper', value: deep(20_000) });
    await tick();
    expect(() => draft.ensureSeeded()).not.toThrow();
    expect(draft.unavailable).toBe(true);
    expect(draft.dirty).toBe(false);
  });
});

describe('submitJsonDraft — one save, bound to where it started (@codex on #893)', () => {
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
    const out = await submitJsonDraft({ url, field: 'properties', text: '{"a":1}', baseline: { x: 1 }, fetchImpl });
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
    expect(await submitJsonDraft({ url: '/x?/updateProperties', field: 'properties', text: '{}', baseline: null, fetchImpl })).toEqual({
      ok: false,
      code: 'rejected',
      detail: 'strict collection',
    });
  });

  it('reads the failure under the FIELD\'s key — dataFailed for the Data tab (#894)', async () => {
    const { calls, fetchImpl } = recorder({
      type: 'failure',
      status: 409,
      data: { dataFailed: { code: 'changed', detail: null } },
    });
    const out = await submitJsonDraft({ url: '/m/nodes/a?/updateData', field: 'data', text: '[1]', baseline: null, fetchImpl });
    expect(out).toEqual({ ok: false, code: 'changed', detail: null });
    expect(calls[0].body.get('data')).toBe('[1]');
    expect(calls[0].body.get('properties')).toBeNull();
  });
});

describe('displayJson — the one serializer for STORED values (@copilot on #896)', () => {
  const deep = (n: number) => {
    let v: unknown = 1;
    for (let k = 0; k < n; k++) v = { a: v };
    return v;
  };

  it('pretty-prints an ordinary value, and compacts on request', () => {
    expect(displayJson({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(displayJson({ a: [1, 2] }, { compact: true })).toBe('{"a":[1,2]}');
    expect(displayJson('text')).toBe('"text"');
  });

  it('falls back to compact when indentation would pass the cap', () => {
    const text = displayJson(deep(500))!;
    expect(text).not.toContain('\n');
    expect(utf8Length(text)).toBeLessThanOrEqual(PROPERTIES_MAX);
  });

  it('returns null — never throws — for a value too deep even for compact JSON, so a RENDER survives it', () => {
    expect(() => displayJson(deep(20_000))).not.toThrow();
    expect(displayJson(deep(20_000))).toBeNull();
    expect(displayJson(deep(20_000), { compact: true })).toBeNull();
  });
});
