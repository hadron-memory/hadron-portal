/**
 * #927 — the Content and Abstract drafts, and the revision each is based on.
 *
 * CLIENT lane because the rules live in an effect (`syncTextDraftWith`), which
 * a server render never runs. The node prop is reassigned the way a reload or
 * a navigation reassigns it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitTextDraft, TextDraft, type TextDraftSource } from './text-draft.svelte';
import Harness from './test/TextDraftHarness.svelte';

type Props = { draft: TextDraft; node: TextDraftSource };
const mounted: Array<Mounted<Props>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

/** Mount through the page's own effect, then OPEN Source — the page seeds on open. */
async function setup(node: TextDraftSource, open = true) {
  const props = reactiveProps<Props>({ draft: new TextDraft(), node });
  const m = mountComponent(Harness, props);
  mounted.push(m);
  await tick();
  if (open) props.draft.ensureSeeded();
  return { props, draft: props.draft };
}

describe('TextDraft through the page effect', () => {
  it('captures the text AND the revision when Source opens, not before', async () => {
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 1 }, false);
    expect(draft.baseRevision).toBeNull();
    // The page loads a newer revision before the user opens the editor.
    props.node = { id: 'a', value: 'v2', revision: 2 };
    await tick();
    draft.ensureSeeded();
    expect(draft.text).toBe('v2');
    expect(draft.baseRevision).toBe(2);
    expect(draft.dirty).toBe(false);
  });

  it('opens an absent value as empty text', async () => {
    const { draft } = await setup({ id: 'a', value: null, revision: 4 });
    expect(draft.text).toBe('');
    expect(draft.baseRevision).toBe(4);
  });

  it('a CHANGED value under a dirty draft keeps the draft AND its revision, so the save conflicts', async () => {
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 1 });
    draft.text = 'mine';
    props.node = { id: 'a', value: 'theirs', revision: 2 };
    await tick();
    expect(draft.text).toBe('mine');
    expect(draft.baseRevision).toBe(1);
    expect(draft.isBehind('theirs')).toBe(true);
  });

  it('a changed value under a CLEAN draft shows the new value at its revision', async () => {
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 1 });
    props.node = { id: 'a', value: 'theirs', revision: 2 };
    await tick();
    expect(draft.text).toBe('theirs');
    expect(draft.baseRevision).toBe(2);
  });

  it('the SAME value at a newer revision moves the revision forward and keeps the edit', async () => {
    // e.g. the user's own Properties save on another tab: this field did not
    // change, so refusing the edit would be a false conflict.
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 1 });
    draft.text = 'mine';
    props.node = { id: 'a', value: 'v1', revision: 2 };
    await tick();
    expect(draft.text).toBe('mine');
    expect(draft.baseRevision).toBe(2);
    expect(draft.isBehind('v1')).toBe(false);
  });

  it('an absent value and empty text are the same value', async () => {
    const { props, draft } = await setup({ id: 'a', value: null, revision: 1 });
    draft.text = 'mine';
    props.node = { id: 'a', value: '', revision: 2 };
    await tick();
    expect(draft.baseRevision).toBe(2);
  });

  it('a different NODE always re-seeds, dirty or not (#251: the page is reused across nodes)', async () => {
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 7 });
    draft.text = 'mine';
    props.node = { id: 'b', value: 'other', revision: 7 };
    await tick();
    expect(draft.dirty).toBe(false);
    draft.ensureSeeded();
    expect(draft.text).toBe('other');
    expect(draft.baseRevision).toBe(7);
  });

  it('reseed() after our own save starts over from what is stored now', async () => {
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 1 });
    draft.text = 'mine';
    props.node = { id: 'a', value: 'mine', revision: 2 };
    await tick();
    // Changed underneath a dirty draft: kept, as for someone else's change…
    expect(draft.baseRevision).toBe(1);
    // …so the page re-seeds explicitly after its own save.
    draft.reseed(props.node);
    draft.ensureSeeded();
    expect(draft.text).toBe('mine');
    expect(draft.baseRevision).toBe(2);
    expect(draft.dirty).toBe(false);
  });

  it('stops syncing once unmounted', async () => {
    const { props, draft } = await setup({ id: 'a', value: 'v1', revision: 1 });
    mounted.pop()!.unmount();
    props.node = { id: 'a', value: 'theirs', revision: 2 };
    await tick();
    expect(draft.text).toBe('v1');
    expect(draft.baseRevision).toBe(1);
  });
});

describe('submitTextDraft', () => {
  function recorder(result: unknown) {
    const calls: Array<{ url: string; body: FormData }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as FormData });
      return new Response(JSON.stringify(result));
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('posts the text and the revision it was based on to the URL it was GIVEN', async () => {
    const { calls, fetchImpl } = recorder({ type: 'success', status: 200 });
    const url = '/app/memories/m/nodes/node-a?/updateContent';
    expect(await submitTextDraft({ url, field: 'content', text: 'body', expectedRevision: 5, fetchImpl })).toEqual({ ok: true });
    expect(calls[0].url).toBe(url);
    expect(calls[0].body.get('content')).toBe('body');
    expect(calls[0].body.get('expectedRevision')).toBe('5');
  });

  it('returns the conflict refusal as data under <field>Failed', async () => {
    const { fetchImpl } = recorder({ type: 'failure', status: 409, data: { abstractFailed: { code: 'changed', detail: null } } });
    expect(
      await submitTextDraft({ url: '/x?/updateAbstract', field: 'abstract', text: 's', expectedRevision: 1, fetchImpl }),
    ).toEqual({ ok: false, code: 'changed', detail: null });
  });

  it('sends no revision rather than a made-up one when the draft has none (the action refuses it)', async () => {
    const { calls, fetchImpl } = recorder({ type: 'failure', status: 400, data: { contentFailed: { code: 'no-baseline', detail: null } } });
    const out = await submitTextDraft({ url: '/x?/updateContent', field: 'content', text: 'b', expectedRevision: null, fetchImpl });
    expect(calls[0].body.has('expectedRevision')).toBe(false);
    expect(out).toEqual({ ok: false, code: 'no-baseline', detail: null });
  });
});
