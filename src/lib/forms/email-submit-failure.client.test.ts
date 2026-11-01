/**
 * portal#1528 — an email sign-in, sign-up or invite submit that fails before
 * an ActionResult comes back must SAY so.
 *
 * Kit's `enhance` hands superforms `{ type: 'error' }` for a rejected fetch and
 * for a body that is not action JSON (an edge HTML 403/5xx/524), and a bare
 * `{ message }` for its own CSRF 403. With a custom `onError` superforms sets no
 * message for any of them (`hrn:node:hadronmemory.com:hadron-portal:findings:custom-superform-onerror-swallows-error-results`),
 * so before this fix the button simply came back with nothing on screen.
 *
 * Controls: a field error (`fail(400)`) and a server `message(...)` error still
 * render exactly as before, once, with no extra alert.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defaults } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithRawResult, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { page } from '$lib/test/stubs/app-stores';
import { authEmailSchema } from '$lib/forms/authEmail';
import { inviteEmailSchema, acceptInvitationSchema } from '../../routes/invite/[token]/schema';
import SignIn from '../../routes/signin/+page.svelte';
import SignUp from '../../routes/signup/+page.svelte';
import Invite from '../../routes/invite/[token]/+page.svelte';

const mounted: ReturnType<typeof mountComponent>[] = [];
const unsubs: Array<() => void> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  while (unsubs.length) unsubs.pop()!();
  page.update((p) => ({ ...p, form: null, status: 200 }));
});

/**
 * Mount a route page whose `form` prop follows the page's action data, as kit
 * does after `applyAction`. The invite page reads its scoped messages from that
 * prop, so a mount that froze it at `null` could never show one.
 */
function mountPage<P extends Record<string, unknown>>(component: unknown, data: Record<string, unknown>): HTMLElement {
  const props = reactiveProps({ data, form: null as unknown }) as unknown as P;
  unsubs.push(page.subscribe((p) => ((props as unknown as { form: unknown }).form = p.form)));
  const m = mountComponent(component as never, props as never);
  mounted.push(m);
  return m.target;
}

const ALL_PROVIDERS =
  "Your sign-in link couldn't be sent. Check your connection and try again, or continue with Google, Apple or GitHub.";
const INVITE_PROVIDERS =
  "Your sign-in link couldn't be sent. Check your connection and try again, or continue with Google or GitHub.";

type Case = {
  name: string;
  mount: () => HTMLElement;
  idleLabel: string;
  failureText: string;
  schema: typeof authEmailSchema | typeof inviteEmailSchema;
};

function authForm() {
  return defaults(zod4(authEmailSchema));
}
function inviteForm() {
  return defaults(zod4(inviteEmailSchema));
}

const cases: Case[] = [
  {
    name: 'sign-in',
    mount: () => mountPage(SignIn, { form: authForm(), authFailed: false }),
    idleLabel: 'Continue with Email',
    failureText: ALL_PROVIDERS,
    schema: authEmailSchema,
  },
  {
    name: 'sign-up',
    mount: () => mountPage(SignUp, { form: authForm() }),
    idleLabel: 'Continue with Email',
    failureText: ALL_PROVIDERS,
    schema: authEmailSchema,
  },
  {
    name: 'invite',
    mount: () =>
      mountPage(Invite, {
        invitation: { organization: { name: 'Acme' }, sender: null, memberRole: 'MEMBER', activationCount: 0 },
        isSignedIn: false,
        slug: 'inv-1',
        acceptForm: defaults(zod4(acceptInvitationSchema)),
        form: inviteForm(),
      }),
    idleLabel: 'Continue with email',
    failureText: INVITE_PROVIDERS,
    schema: inviteEmailSchema,
  },
];

/** The email form, with a valid address typed so client validation lets it go. */
async function readyForm(root: HTMLElement): Promise<HTMLFormElement> {
  await tick(2);
  const input = root.querySelector<HTMLInputElement>('input#email')!;
  input.value = 'reader@example.test';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  return input.form!;
}

const alerts = (root: HTMLElement) => [...root.querySelectorAll('[role="alert"]')].map((a) => a.textContent?.trim());
const submitButton = (form: HTMLFormElement) => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

/** What kit's enhance hands superforms when no ActionResult came back. */
const NON_RESULTS: Array<[string, unknown]> = [
  // An edge HTML page (Cloudflare 403 challenge/block, 5xx, 524): deserialize throws.
  ['an HTML 403 from the edge', { type: 'error', error: new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON") }],
  // Offline, reset, DNS: the fetch itself rejects.
  ['a rejected fetch', { type: 'error', error: new TypeError('Failed to fetch') }],
  // Kit's own CSRF refusal answers an enhanced submit with JSON that has no `type`.
  ['the CSRF {message} 403', { message: 'Cross-site POST form submissions are forbidden' }],
];

describe.each(cases)('$name email form: a submit with no ActionResult (portal#1528)', (c) => {
  it.each(NON_RESULTS)('%s shows one alert saying the link was not sent, and the button is idle again', async (_label, raw) => {
    const root = c.mount();
    const form = await readyForm(root);
    const { cancelled } = await submitEnhancedWithRawResult(form, raw);
    expect(cancelled).toBe(false);
    await tick(4);
    expect(alerts(root)).toEqual([c.failureText]);
    expect(submitButton(form).disabled).toBe(false);
    expect(submitButton(form).textContent?.trim()).toBe(c.idleLabel);
  });

  it('a later submit clears the failure before its own answer is shown', async () => {
    const root = c.mount();
    const form = await readyForm(root);
    await submitEnhancedWithRawResult(form, NON_RESULTS[1][1]);
    await tick(4);
    expect(alerts(root)).toEqual([c.failureText]);
    const ok = { ...(c.name === 'invite' ? inviteForm() : authForm()), message: { type: 'error' as const, text: 'Too many sign-in attempts.' } };
    await submitEnhancedWithResult(form, { type: 'failure', status: 429, data: { form: ok } });
    await tick(4);
    expect(alerts(root)).toEqual(['Too many sign-in attempts.']);
  });
});

describe.each(cases)('$name email form: controls that already worked stay unchanged (portal#1528)', (c) => {
  it('a server message(...) error renders once, as before', async () => {
    const root = c.mount();
    const form = await readyForm(root);
    const failed = { ...(c.name === 'invite' ? inviteForm() : authForm()), message: { type: 'error' as const, text: 'Complete the check and try again.' } };
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { form: failed } });
    await tick(4);
    expect(alerts(root)).toEqual(['Complete the check and try again.']);
  });

  it('a fail(400) field error renders as the field error, with no submit-failure alert', async () => {
    const root = c.mount();
    const form = await readyForm(root);
    const invalid = { ...(c.name === 'invite' ? inviteForm() : authForm()), valid: false, errors: { email: ['Enter a valid email address.'] } };
    await submitEnhancedWithResult(form, { type: 'failure', status: 400, data: { form: invalid } });
    await tick(4);
    expect(root.textContent).toContain('Enter a valid email address.');
    expect(alerts(root).filter((a) => a === c.failureText)).toEqual([]);
  });
});

// portal#1532 item 2 (Gabriel P3 1): only a rejected fetch is a connection
// problem. An edge page or kit's CSRF refusal answered, so the copy must not
// send the reader off to check their connection.
const NOT_CONNECTION = "Your sign-in link couldn't be sent. Try again in a moment, or continue with Google, Apple or GitHub.";
describe('sign-in email form: the failure copy names a connection problem only for a rejected fetch (portal#1532)', () => {
  it.each([
    ['a rejected fetch', NON_RESULTS[1][1], ALL_PROVIDERS],
    ['an HTML 403 from the edge', NON_RESULTS[0][1], NOT_CONNECTION],
    ['the CSRF {message} 403', NON_RESULTS[2][1], NOT_CONNECTION],
  ])('%s', async (_label, raw, expected) => {
    const root = cases[0].mount();
    const form = await readyForm(root);
    await submitEnhancedWithRawResult(form, raw);
    await tick(4);
    expect(alerts(root)).toEqual([expected]);
  });
});

// portal#1532 item 4 (Gabriel P3 4): the signed-in reader's Accept form had
// superforms' default onError, which rethrows, so the same non-results left the
// button idle and nothing on screen.
describe('invite accept form: a submit with no ActionResult (portal#1532)', () => {
  const ACCEPT_FAILURE = "Your invitation couldn't be accepted. Try again in a moment.";
  const ACCEPT_OFFLINE = "Your invitation couldn't be accepted. Check your connection and try again.";
  const mountSignedIn = () =>
    mountPage(Invite, {
      invitation: { organization: { name: 'Acme' }, sender: null, memberRole: 'MEMBER', activationCount: 0 },
      isSignedIn: true,
      slug: 'inv-1',
      acceptForm: defaults(zod4(acceptInvitationSchema)),
      form: inviteForm(),
    });

  it.each([
    ['an HTML 403 from the edge', NON_RESULTS[0][1], ACCEPT_FAILURE],
    ['a rejected fetch', NON_RESULTS[1][1], ACCEPT_OFFLINE],
    ['the CSRF {message} 403', NON_RESULTS[2][1], ACCEPT_FAILURE],
  ])('%s shows one alert and the button is idle again', async (_label, raw, expected) => {
    const root = mountSignedIn();
    await tick(2);
    const form = root.querySelector<HTMLFormElement>('form[action="?/accept"]')!;
    await submitEnhancedWithRawResult(form, raw).catch(() => undefined);
    await tick(4);
    expect(alerts(root)).toEqual([expected]);
    expect(submitButton(form).disabled).toBe(false);
    expect(submitButton(form).textContent?.trim()).toBe('Accept invitation');
  });
});
