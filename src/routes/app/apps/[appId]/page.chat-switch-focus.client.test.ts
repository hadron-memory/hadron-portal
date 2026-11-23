/**
 * #1407 — focus after a chat switch. Choosing a chat makes the whole panel
 * inert while the navigation runs. A browser drops focus from a control that
 * turns inert; jsdom does not, so the test blurs the selector the way the
 * browser does and asserts where focus ends up.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  window.history.replaceState({}, '', '/');
});

const isInert = (el: HTMLElement) => el.hasAttribute('inert') || (el as HTMLElement & { inert?: boolean }).inert === true;
const twoChats = [
  { key: 'chats:team', label: 'Team', loc: 'chats:team' },
  { key: 'chats:other', label: 'Other', loc: 'chats:other' },
] as never;

async function chatsPage() {
  setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1?tab=chats');
  const data = await pageData();
  const m = mountComponent(Page as never, { data: { ...data, appChats: twoChats }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  const select = m.target.querySelector<HTMLSelectElement>('#app-chat-select')!;
  const panel = m.target.querySelector<HTMLElement>('#panel-chats')!;
  return { select, panel, target: m.target };
}

async function choose(select: HTMLSelectElement, hold: { release?: () => void }) {
  navigationHooks.onGoto = () => new Promise<void>((r) => { hold.release = r; });
  select.value = 'chats:other';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await tick(2);
}

describe('chat selector focus across a switch (#1407)', () => {
  it('returns focus to the selector after the switch when the browser dropped it', async () => {
    const { select, panel } = await chatsPage();
    select.focus();
    expect(document.activeElement).toBe(select);
    const hold: { release?: () => void } = {};
    await choose(select, hold);
    expect(isInert(panel)).toBe(true);
    select.blur(); // what the browser does to a control inside an inert subtree
    expect(document.activeElement).not.toBe(select);
    hold.release!();
    await tick(6);
    expect(isInert(panel)).toBe(false);
    expect(document.activeElement).toBe(select);
  });

  it('does not take focus when the selector never had it', async () => {
    const { select } = await chatsPage();
    const hold: { release?: () => void } = {};
    await choose(select, hold);
    hold.release!();
    await tick(6);
    expect(document.activeElement).not.toBe(select);
  });

  it('does not steal focus the reader moved elsewhere during the switch', async () => {
    const { select } = await chatsPage();
    select.focus();
    const hold: { release?: () => void } = {};
    await choose(select, hold);
    select.blur();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    hold.release!();
    await tick(6);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
