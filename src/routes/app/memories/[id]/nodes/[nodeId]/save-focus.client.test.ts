/**
 * #1446 — after a successful Content or Abstract save the editor closes, which
 * unmounts the focused Save button and used to leave focus on <body>. Focus now
 * lands on that section's Source toggle, the control that reopens the editor.
 * A conflict or an error keeps focus in the editor.
 *
 * Mounts the REAL node page with data from the REAL loader, as
 * `properties-tab.client.test.ts` does: the behaviour lives in the page's save
 * handlers and the lifetime of the controls they unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: null, properties: null,
  objectType: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetStubPage();
  document.body.innerHTML = '';
});

async function mountPage(tab: 'content' | 'abstract') {
  const href = `http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`;
  setStubPage(href, { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(href),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...data }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  // The editors measure/focus against the document, so attach the mount point.
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return Object.assign(m, { props });
}

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

const reply = (body: unknown) =>
  vi.fn().mockResolvedValue({ text: async () => JSON.stringify(body) });
const SUCCESS = { type: 'success', status: 200, data: '[]' };

async function editAndSave(target: HTMLElement, field: 'content' | 'abstract') {
  buttonNamed(target, 'Source')!.click();
  flushSync();
  // The page carries other textareas (composers); the editor is the one with the draft.
  const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea[rows="6"], textarea' : 'textarea[maxlength="2000"]')!;
  area.value = `${field} edited`;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  const save = buttonNamed(target, 'Save')!;
  save.focus();
  expect(document.activeElement).toBe(save);
  save.click();
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
  return area;
}

/**
 * A browser blurs a focused control the moment it becomes `disabled`; jsdom does
 * not. The page disables Save for the length of a save, so a failed save lands
 * with focus on <body> in a real browser (QA, #1563). This holds the request
 * open, models that blur, then answers with the given failure.
 */
// jsdom's blur() is a no-op on a disabled control, so move focus to a focusable
// <body>, which is where a browser leaves it.
function blurLikeABrowser() {
  document.body.tabIndex = -1;
  document.body.focus();
  document.body.removeAttribute('tabindex');
}

async function failWithBlurredSave(target: HTMLElement, field: 'content' | 'abstract', failure: unknown) {
  let answer!: (r: { text: () => Promise<string> }) => void;
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => (answer = r))));
  buttonNamed(target, 'Source')!.click();
  flushSync();
  const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea' : 'textarea[maxlength="2000"]')!;
  area.value = `${field} edited`;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  const save = buttonNamed(target, 'Save')!;
  save.focus();
  save.click();
  flushSync();
  expect(save.disabled).toBe(true);
  blurLikeABrowser(); // what the browser does to a disabled control
  expect(document.activeElement).toBe(document.body);
  answer({ text: async () => JSON.stringify(failure) });
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
  return { area, save };
}

const CONFLICT = (field: string) => ({
  type: 'failure',
  status: 409,
  data: JSON.stringify([{ [`${field}Failed`]: 1 }, { code: 2, detail: 3 }, 'changed', null]),
});

describe('focus after a refused Source save (#1563 QA)', () => {
  for (const field of ['content', 'abstract'] as const) {
    it(`${field}: a refused save returns focus to a live editor control, not <body>`, async () => {
      const { target } = await mountPage(field);
      const { area, save } = await failWithBlurredSave(target, field, CONFLICT(field));
      expect(area.isConnected).toBe(true);
      expect(save.disabled).toBe(false);
      expect(document.activeElement).not.toBe(document.body);
      expect([save, area]).toContain(document.activeElement);
    });

    it(`${field}: a thrown request also returns focus`, async () => {
      const { target } = await mountPage(field);
      let boom!: (e: Error) => void;
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((_, rej) => (boom = rej))));
      buttonNamed(target, 'Source')!.click();
      flushSync();
      const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea' : 'textarea[maxlength="2000"]')!;
      area.value = 'x';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      const save = buttonNamed(target, 'Save')!;
      save.focus();
      save.click();
      flushSync();
      blurLikeABrowser();
      boom(new Error('network'));
      for (let i = 0; i < 10; i++) await tick();
      flushSync();
      expect(document.activeElement).not.toBe(document.body);
    });
  }
});

describe('a save does not steal focus the user moved meanwhile (#1563 BLIND)', () => {
  for (const field of ['content', 'abstract'] as const) {
    it(`${field}: success leaves focus where the user put it during the save`, async () => {
      const { target } = await mountPage(field);
      let answer!: (r: { text: () => Promise<string> }) => void;
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => (answer = r))));
      buttonNamed(target, 'Source')!.click();
      flushSync();
      const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea' : 'textarea[maxlength="2000"]')!;
      area.value = `${field} edited`;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      const save = buttonNamed(target, 'Save')!;
      save.focus();
      save.click();
      flushSync();
      // While the save is in flight the user moves to another live control.
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      elsewhere.focus();
      answer({ text: async () => JSON.stringify(SUCCESS) });
      for (let i = 0; i < 10; i++) await tick();
      flushSync();
      expect(document.activeElement).toBe(elsewhere);
    });

    it(`${field}: a refused save also leaves a moved focus alone`, async () => {
      const { target } = await mountPage(field);
      let answer!: (r: { text: () => Promise<string> }) => void;
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => (answer = r))));
      buttonNamed(target, 'Source')!.click();
      flushSync();
      const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea' : 'textarea[maxlength="2000"]')!;
      area.value = `${field} edited`;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      const save = buttonNamed(target, 'Save')!;
      save.focus();
      save.click();
      flushSync();
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      elsewhere.focus();
      answer({ text: async () => JSON.stringify(CONFLICT(field)) });
      for (let i = 0; i < 10; i++) await tick();
      flushSync();
      expect(document.activeElement).toBe(elsewhere);
    });
  }
});

describe('a save finishing after the route moved to another node does not focus it (#1563 LOCAL)', () => {
  for (const field of ['content', 'abstract'] as const) {
    it(`${field}: node A's completed save leaves node B's Source toggle alone`, async () => {
      const { target, props } = await mountPage(field);
      let answer!: (r: { text: () => Promise<string> }) => void;
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => (answer = r))));
      buttonNamed(target, 'Source')!.click();
      flushSync();
      const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea' : 'textarea[maxlength="2000"]')!;
      area.value = `${field} edited`;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      const save = buttonNamed(target, 'Save')!;
      save.focus();
      save.click();
      flushSync();

      // The moment A's editor unmounts (inside the render the save awaits), the
      // reused route becomes node B, and navigation leaves focus on <body>.
      const dataA = props.data as { node: Record<string, unknown> };
      let moved = false;
      const mo = new MutationObserver(() => {
        if (moved || area.isConnected) return;
        moved = true;
        props.data = { ...dataA, node: { ...dataA.node, id: 'other-pk', loc: 'bar', name: 'Bar' } };
        flushSync();
        blurLikeABrowser();
      });
      mo.observe(target, { childList: true, subtree: true });
      answer({ text: async () => JSON.stringify(SUCCESS) });
      for (let i = 0; i < 10; i++) await tick();
      flushSync();
      mo.disconnect();

      expect(moved).toBe(true);
      expect(document.activeElement).toBe(document.body);
    });
  }
});

describe('focus after a Source save (#1446)', () => {
  for (const field of ['content', 'abstract'] as const) {
    it(`${field}: a successful save puts focus on the Source toggle, not <body>`, async () => {
      const { target } = await mountPage(field);
      vi.stubGlobal('fetch', reply(SUCCESS));
      const area = await editAndSave(target, field);

      // The editor closed...
      expect(area.isConnected).toBe(false);
      // ...and focus is on the control that reopens it.
      const source = buttonNamed(target, 'Source')!;
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(source);
    });

    it(`${field}: a refused save keeps focus in the editor`, async () => {
      const { target } = await mountPage(field);
      vi.stubGlobal(
        'fetch',
        reply({ type: 'failure', status: 400, data: JSON.stringify([{ [`${field}Failed`]: 1 }, { code: 2, detail: 3 }, 'invalid', null]) }),
      );
      const area = await editAndSave(target, field);

      expect(area.isConnected).toBe(true);
      expect(document.activeElement).not.toBe(buttonNamed(target, 'Source'));
    });
  }
});
