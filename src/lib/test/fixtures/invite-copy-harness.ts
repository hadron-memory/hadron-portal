import { flushSync, mount, unmount } from 'svelte';
import Invite from '../../../routes/app/account/invite/+page.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';

export const INVITE_URL = 'https://example.test/invite/qa-synthetic';
export function mountInviteCopy(target: HTMLElement) {
  const props = reactiveProps({ data: { form: {}, prefillEmail: '' },
    form: { invited: true, inviteUrl: INVITE_URL } });
  const instance = mount(Invite, { target, props: props as never });
  flushSync();
  return {
    replace(url: string) { props.form = { invited: true, inviteUrl: url }; flushSync(); },
    destroy() { unmount(instance); flushSync(); },
  };
}
