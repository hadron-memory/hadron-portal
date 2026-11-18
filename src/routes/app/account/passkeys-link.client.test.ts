/**
 * portal#1022 links half — the account page's Passkeys section mounts, links
 * out to the server-hosted registration page, and unmounts cleanly. Client
 * lane because the section's visibility rides on loader data the component
 * reads at mount; a server render never exercises teardown (#782/#788).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const user = { id: 'u1', name: 'Ada', handle: 'ada', email: 'ada@example.com', githubUsername: null, avatarUrl: null };
const profileForm = {
  id: 'f1', valid: true, posted: false, errors: {}, constraints: {},
  data: { name: 'Ada', handle: 'ada', email: 'ada@example.com' },
};

function mountAccount(passkeysUrl: Promise<string | null>) {
  const m = mountComponent(Page as never, {
    data: { user, form: { ...profileForm }, passkeysUrl },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m;
}

describe('account page — Passkeys section (portal#1022)', () => {
  it('renders nothing while the streamed capability answer is still in flight', () => {
    const m = mountAccount(new Promise<string | null>(() => {}));
    expect(m.target.querySelector('[data-testid="passkeys-section"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="passkeys-register-link"]')).toBeNull();
  });

  it('links to the server-hosted registration page, in its own tab, once the answer lands', async () => {
    const m = mountAccount(Promise.resolve('https://server.example/passkeys/register'));
    await tick();
    const link = m.target.querySelector<HTMLAnchorElement>('[data-testid="passkeys-register-link"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('https://server.example/passkeys/register');
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toBe('noopener');
    expect(m.target.querySelector('[data-testid="passkeys-section"]')).not.toBeNull();
  });

  it('renders no section at all while registration is switched off', async () => {
    const m = mountAccount(Promise.resolve(null));
    await tick();
    expect(m.target.querySelector('[data-testid="passkeys-section"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="passkeys-register-link"]')).toBeNull();
  });

  it('unmounts cleanly with the section present', async () => {
    const m = mountComponent(Page as never, {
      data: { user, form: { ...profileForm }, passkeysUrl: Promise.resolve('https://server.example/passkeys/register') },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    await tick();
    expect(m.target.querySelector('[data-testid="passkeys-register-link"]')).not.toBeNull();
    m.unmount();
    expect(m.target.querySelector('[data-testid="passkeys-register-link"]')).toBeNull();
  });
});
