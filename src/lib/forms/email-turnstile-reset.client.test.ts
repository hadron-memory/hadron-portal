/**
 * portal#1474 item 5: the bot check is reset after every answered submit on each real form, not
 * just in the helper (email-submit-failure-reset.client.test.ts pins the helper). A page that
 * dropped `onUpdated`/`onError` from its superForm options, or wired `resetCheck` to anything but
 * its own widget, kept a spent token and passed the whole suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { env } from '$env/dynamic/public';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithRawResult, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { page } from '$lib/test/stubs/app-stores';
import { authEmailSchema } from '$lib/forms/authEmail';
import { inviteEmailSchema, acceptInvitationSchema } from '../../routes/invite/[token]/schema';
import SignIn from '../../routes/signin/+page.svelte';
import SignUp from '../../routes/signup/+page.svelte';
import Invite from '../../routes/invite/[token]/+page.svelte';

const api = { render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() };
const mounted: ReturnType<typeof mountComponent>[] = [];
const unsubs: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
  (window as { turnstile?: unknown }).turnstile = api;
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  while (unsubs.length) unsubs.pop()!();
  page.update((p) => ({ ...p, form: null, status: 200 }));
  Reflect.deleteProperty(env, 'PUBLIC_TURNSTILE_SITE_KEY');
  delete (window as { turnstile?: unknown }).turnstile;
});

function mountPage(component: unknown, data: Record<string, unknown>): HTMLElement {
  const props = reactiveProps({ data, form: null as unknown });
  unsubs.push(page.subscribe((p) => ((props as unknown as { form: unknown }).form = p.form)));
  const m = mountComponent(component as never, props as never);
  mounted.push(m);
  return m.target;
}
const authForm = () => defaults(zod4(authEmailSchema));
const inviteForm = () => defaults(zod4(inviteEmailSchema));
const cases = [
  { name: 'sign-in', form: authForm, mount: () => mountPage(SignIn, { form: authForm(), authFailed: false }) },
  { name: 'sign-up', form: authForm, mount: () => mountPage(SignUp, { form: authForm() }) },
  {
    name: 'invite', form: inviteForm,
    mount: () => mountPage(Invite, {
      invitation: { organization: { name: 'Acme' }, sender: null, memberRole: 'MEMBER', activationCount: 0 },
      isSignedIn: false, slug: 'inv-1', acceptForm: defaults(zod4(acceptInvitationSchema)), form: inviteForm(),
    }),
  },
];

async function readyForm(root: HTMLElement): Promise<HTMLFormElement> {
  await tick(3);
  const input = root.querySelector<HTMLInputElement>('input#email')!;
  input.value = 'reader@example.test';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  return input.form!;
}

describe.each(cases)('$name email form resets its own bot check after every answered submit', (c) => {
  it('renders the check inside the email form', async () => {
    const root = c.mount();
    const form = await readyForm(root);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(form.querySelector('[data-testid="turnstile-widget"]')).not.toBeNull();
  });
  it('an applied result (onUpdated) resets the widget', async () => {
    const form = await readyForm(c.mount());
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { form: { ...c.form(), message: { type: 'error', text: 'Complete the check and try again.' } } } });
    await tick(4);
    expect(api.reset).toHaveBeenCalledWith('w1');
  });
  it('a submit with no ActionResult (onError) resets the widget', async () => {
    const form = await readyForm(c.mount());
    await submitEnhancedWithRawResult(form, { type: 'error', error: new TypeError('Failed to fetch') });
    await tick(4);
    expect(api.reset).toHaveBeenCalledWith('w1');
  });
});
