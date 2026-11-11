import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { updateSignatureFormId, updateSignatureSchema } from './schema';
import Section from './WorkerSignatureSection.svelte';

vi.mock('$app/forms', () => import('$lib/test/stubs/app-forms'));
vi.mock('$app/environment', () => import('$lib/test/stubs/app-environment-ssr'));

// #1852 — the server-rendered first paint of the saved-value link check. A
// server render never runs effects, so the read has not started: the reader must
// see the loading copy, never an all-clear or the unavailable state, until the
// client mounts and reads. The client-mount aria-busy pin lives in
// signature-lint.client.test.ts.
async function paint(signature: string | null, trailer: string | null) {
  const initialForm = await superValidate({ signature: signature ?? '', trailer: trailer ?? '', signatureBase: signature ?? '', trailerBase: trailer ?? '' }, zod4(updateSignatureSchema), { errors: false, id: updateSignatureFormId('a') });
  return render(Section as never, { props: { workerId: 'a', signature, trailer, retired: false, initialForm, actionResult: undefined } as never }).body;
}

describe('#1852 SSR initial loading paint of the worker-link check', () => {
  it('paints the loading copy in the check region, with no all-clear, warning or Retry', async () => {
    const html = await paint('signature', 'trailer');
    expect(html).toContain('data-signature-lint');
    expect(html).toContain('Checking the saved worker link…');
    expect(html).not.toContain('No worker-link warnings on the saved values.');
    expect(html).not.toContain('Couldn’t check the worker link.');
    expect(html).not.toContain('data-signature-lint-field');
    expect(html).not.toMatch(/>\s*Retry\s*</);
    expect(html).toContain('Saved-value advice refreshes after a successful save.');
  });
  it('paints no check at all when both templates are masked', async () => {
    const html = await paint(null, null);
    expect(html).not.toContain('data-signature-lint');
    expect(html).not.toContain('Checking the saved worker link…');
  });
});
