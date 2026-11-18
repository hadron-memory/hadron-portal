import { flushSync, mount, unmount } from 'svelte';
import Invite from '../../../routes/app/account/invite/+page.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';

/**
 * The Invite page's props, typed structurally for the clipboard harness
 * (#1742): `data` is the loader payload the page reads (its Superforms form
 * seed plus the ?email= prefill) and `form` is the action result that turns
 * the success banner on. Assignments through `props.form` below are checked
 * against this shape; the single `as never` boundary cast is the fixture's
 * stand-in for SvelteKit's generated $types, which a Vite-aliased fixture
 * cannot import.
 */
export type InviteCopyProps = {
  data: { form: unknown; prefillEmail: string };
  form: { invited: true; inviteUrl: string; maxActivations?: number; expiresAt?: string } | null;
};

export function mountInviteCopy(target: HTMLElement, inviteUrl: string) {
  const props = reactiveProps<InviteCopyProps>({
    data: { form: {}, prefillEmail: '' },
    form: { invited: true, inviteUrl },
  });
  const instance = mount(Invite, { target, props: props as never });
  flushSync();
  return {
    replace(url: string) { props.form = { invited: true, inviteUrl: url }; flushSync(); },
    destroy() { unmount(instance); flushSync(); },
  };
}
