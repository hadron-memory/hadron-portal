/**
 * #668 — the revoke confirm, in the CLIENT lane, because the thing worth
 * asserting does not exist until someone clicks.
 *
 * `deleteMemoryShare` is one server mutation serving two authorization paths,
 * told apart ONLY by whether `granteeRef` is present: omit it and the server
 * targets the CALLER's own grantee row instead. So a revoke form that rendered
 * without a ref would not error — it would succeed, against the wrong row.
 *
 * That form is gated behind a confirm click, so the `node` lane never sees it
 * (a server render never mounts, and `confirmRevokeFor` starts null). Asserting
 * it there is impossible; asserting it here is the whole point of the lane.
 */
import { describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { createShareSchema, revokeShareSchema, updateShareRoleSchema } from './schema';

// NO `vi.mock` for `$app/*` here. The client project ALIASES them
// (vitest.config.ts), and a per-test mock silently wins over the alias — an
// earlier draft of this file mocked `$app/forms` as `{ enhance: () => ({}) }`
// and every test died on `enhanced.destroy is not a function`, because
// superforms reads `.destroy` off what kit's enhance returns. The stub is the
// one place that shape is stated.
import Page from './+page.svelte';

const share = (id: string, handle: string) => ({
  role: 'reader',
  createdAt: '1789430400000',
  updatedAt: null,
  grantee: { id, urn: `hrn:user:${handle}`, handle, name: handle, email: null, avatarUrl: null },
  grantor: { id: 'owner-1', urn: 'hrn:user:holger', handle: 'holger', name: 'Holger' },
});

async function mountShare(shares: ReturnType<typeof share>[]) {
  setStubPage('https://example.test/app/memories/mem-1/share', { id: 'mem-1' });
  const [createForm, roleForm, revokeForm] = await Promise.all([
    superValidate({ granteeRef: '', role: 'reader' as const }, zod4(createShareSchema), { errors: false }),
    superValidate(zod4(updateShareRoleSchema), { errors: false }),
    superValidate(zod4(revokeShareSchema), { errors: false }),
  ]);
  return mountComponent(Page as never, {
    data: {
      shareMemory: {
        id: 'mem-1', name: 'Notes', urn: 'hrn:mem:acme.com:notes',
        class: 'personal', userId: 'owner-1', shareable: true, shares,
      },
      shares,
      user: { id: 'owner-1', handle: 'holger', roles: [] },
      createForm, roleForm, revokeForm,
    },
    form: null,
  } as never);
}

/** Click and settle Svelte's effect queue — a bare `.click()` asserts against
 *  a component that has not re-rendered yet, which passes for the wrong reason. */
function click(el: Element | undefined | null) {
  (el as HTMLElement).click();
  flushSync();
}

const revokeButtons = (target: HTMLElement) =>
  [...target.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Remove access');

const revokeForm = (target: HTMLElement) =>
  target.querySelector<HTMLFormElement>('form[action="?/revokeShare"]');

describe('#668 revoke confirm (client)', () => {
  it('opens a revoke form carrying the clicked row’s grantee ref, never a blank one', async () => {
    const { target, unmount } = await mountShare([share('u-2', 'ada'), share('u-3', 'bob')]);
    try {
      expect(revokeForm(target)).toBeNull(); // nothing to submit before confirming

      click(revokeButtons(target)[1]);

      const form = revokeForm(target);
      expect(form).not.toBeNull();
      const ref = form!.querySelector<HTMLInputElement>('input[name="granteeRef"]');
      // The SECOND row's grantee, and non-empty. A blank value here would be
      // "delete my own share" server-side, and it would succeed.
      expect(ref?.value).toBe('u-3');
      expect(ref?.value.trim()).not.toBe('');
    } finally {
      unmount();
    }
  });

  it('confirms ONE row at a time, so an open confirm cannot submit another row', async () => {
    const { target, unmount } = await mountShare([share('u-2', 'ada'), share('u-3', 'bob')]);
    try {
      click(revokeButtons(target)[0]);
      expect(revokeForm(target)!.querySelector<HTMLInputElement>('input[name="granteeRef"]')!.value).toBe('u-2');

      // Open the other row's confirm: the first must close, not coexist.
      click(revokeButtons(target)[0]); // now the only remaining button is row 2's
      const forms = target.querySelectorAll('form[action="?/revokeShare"]');
      expect(forms.length).toBe(1);
      expect(forms[0]!.querySelector<HTMLInputElement>('input[name="granteeRef"]')!.value).toBe('u-3');
    } finally {
      unmount();
    }
  });

  it('cancel closes the form without leaving a submittable one behind', async () => {
    const { target, unmount } = await mountShare([share('u-2', 'ada')]);
    try {
      click(revokeButtons(target)[0]);
      expect(revokeForm(target)).not.toBeNull();

      const cancel = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel');
      click(cancel);

      expect(revokeForm(target)).toBeNull();
    } finally {
      unmount();
    }
  });

  it('unmounts cleanly with a confirm left open', async () => {
    // The teardown path this lane exists for: leaving destructive UI open and
    // navigating away must not throw.
    const { target, unmount } = await mountShare([share('u-2', 'ada')]);
    click(revokeButtons(target)[0]);
    expect(revokeForm(target)).not.toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
