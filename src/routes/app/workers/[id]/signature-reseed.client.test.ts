/**
 * portal#1142 P4 — Jane's local P2 on #1157: a same-worker re-read (the loader
 * runs again after any save on this page, or a query-only navigation) must
 * reseed the signature section coherently. The worker-id key covers only a
 * different worker.
 *
 * Per field, when the stored template changes under the section:
 * - untouched (value === its base): value AND base move to the new stored text,
 *   so nothing stale is posted as a change;
 * - already equal to the new stored text (the reader's own save landing): the
 *   base catches up, so the field is clean again;
 * - a real draft: kept, with its ORIGINAL base, never a moved baseline under
 *   a retained draft.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { updateSignatureSchema } from './schema';
import Section from './WorkerSignatureSection.svelte';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function formFor(signature: string, trailer: string) {
  return superValidate({ signature, trailer, signatureBase: signature, trailerBase: trailer }, zod4(updateSignatureSchema), { errors: false });
}

async function mountSection(signature: string, trailer: string) {
  const props = reactiveProps({
    signature: signature as string | null,
    trailer: trailer as string | null,
    retired: false,
    initialForm: await formFor(signature, trailer),
    actionResult: undefined as unknown,
  });
  const m = mountComponent(Section as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { props, target: m.target };
}

/** What the browser would post: the section's real form, serialized. */
function posted(target: HTMLElement): Record<string, string> {
  const form = target.querySelector('form')!;
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
}

function type(target: HTMLElement, name: string, value: string) {
  const el = target.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('signature section: same-worker re-read', () => {
  it('an untouched template follows the fresher stored text, value and base together', async () => {
    const { props, target } = await mountSection('ORIGINAL', 'T');
    props.signature = 'OTHER-WRITER';
    props.initialForm = await formFor('OTHER-WRITER', 'T');
    flushSync();
    expect(posted(target)).toMatchObject({ signature: 'OTHER-WRITER', signatureBase: 'OTHER-WRITER', trailer: 'T', trailerBase: 'T' });
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('a real draft is kept against its original base', async () => {
    const { props, target } = await mountSection('ORIGINAL', 'T');
    type(target, 'signature', 'MY DRAFT');
    props.signature = 'OTHER-WRITER';
    flushSync();
    expect(posted(target)).toMatchObject({ signature: 'MY DRAFT', signatureBase: 'ORIGINAL' });
  });

  it('the reader’s own save landing makes the field clean again', async () => {
    const { props, target } = await mountSection('ORIGINAL', 'T');
    type(target, 'signature', 'SAVED TEXT');
    props.signature = 'SAVED TEXT';
    flushSync();
    expect(posted(target)).toMatchObject({ signature: 'SAVED TEXT', signatureBase: 'SAVED TEXT' });
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('each field reseeds on its own: a trailer change leaves a signature draft alone', async () => {
    const { props, target } = await mountSection('ORIGINAL', 'T');
    type(target, 'signature', 'MY DRAFT');
    props.trailer = 'T2';
    flushSync();
    expect(posted(target)).toMatchObject({ signature: 'MY DRAFT', signatureBase: 'ORIGINAL', trailer: 'T2', trailerBase: 'T2' });
  });
});
