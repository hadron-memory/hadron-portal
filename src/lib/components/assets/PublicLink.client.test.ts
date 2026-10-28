/**
 * #1131 — the per-asset public-link switch on both surfaces (the asset table's
 * ⋯ menu and the node's asset card), in the client lane.
 *
 * What lives here cannot be seen by a server render: the menu is closed until
 * clicked, the confirmation is component state, the single-flight guard is a
 * click handler, and the teardown case is about what runs AFTER unmount. Every
 * behavioural guard has a test that fails without it (the mutants are listed in
 * the PR, not in code).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import type { AssetSummary } from '$lib/api/assetUpload';
import AssetTable from './AssetTable.svelte';
import NodeAssetCard from './NodeAssetCard.svelte';
import Host from '$lib/test/hosts/AssetRefetchHost.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

function asset(over: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: 'asset-1', memoryId: 'mem-1', urn: 'hrn:asset:hadronmemory.com:dev:assets:asset-1',
    filename: 'notes.md', mimeType: 'text/markdown', sizeBytes: 2048,
    uploadedAt: '2026-08-01T10:00:00.000Z', uploadedBy: 'user-1',
    scanStatus: 'CLEAN', scanSignature: null, description: null, publicUrl: null,
    publicLinkEnabled: false, canManagePublicLink: true, publicLinkAvailable: true,
    ...over,
  };
}

const URL_ON = 'https://hadron.example/assets/asset-1';

/** A manager's view of the asset after the server switched the link. */
const switched = (enabled: boolean) => asset({ publicLinkEnabled: enabled, publicUrl: enabled ? URL_ON : null });

type Reply = { status: number; body: unknown };
interface Fetch {
  fn: ReturnType<typeof vi.fn>;
  /** Bodies POSTed to the switch endpoint. */
  switchCalls: () => unknown[];
}

function stubFetch(reply: () => Reply | Promise<Reply>): Fetch {
  const fn = vi.fn(async (url: string, _init?: { body: string }) => {
    if (!String(url).includes('/api/assets/public-link')) return { ok: false, status: 404, statusText: '', json: async () => ({}) };
    const r = await reply();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '', json: async () => r.body };
  });
  vi.stubGlobal('fetch', fn);
  return {
    fn,
    switchCalls: () => fn.mock.calls
      .filter(([u]) => String(u).includes('/api/assets/public-link'))
      .map(([, init]) => JSON.parse((init as { body: string }).body)),
  };
}

/** Let a fetch → json → state-write chain finish: a macrotask, then the effect flush. */
async function settle() {
  await wait(0);
  await tick(2);
}

const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('button')];
const button = (root: HTMLElement, text: string) => buttons(root).find((b) => b.textContent?.trim() === text);

function mountTable(assets: AssetSummary[], extra: Record<string, unknown> = {}) {
  const m = mountComponent(AssetTable as never, { assets, showMemory: true, ...extra } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m;
}
function menuItems(root: HTMLElement) {
  root.querySelector<HTMLButtonElement>('button[aria-label="Actions for notes.md"]')!.click();
  flushSync();
  return [...root.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
}
const labels = (items: HTMLElement[]) => items.map((i) => i.textContent?.trim());
function pick(root: HTMLElement, label: string) {
  menuItems(root).find((i) => i.textContent?.trim() === label)!.click();
  flushSync();
}

function mountCard(a: AssetSummary) {
  const m = mountComponent(NodeAssetCard as never, { asset: a } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m;
}

describe('asset table: which switch is offered', () => {
  it('flag off: offers "Turn on public link" and no copy-link action', () => {
    const { target } = mountTable([asset()]);
    const items = labels(menuItems(target));
    expect(items).toContain('Turn on public link');
    expect(items).not.toContain('Turn off public link');
    expect(items).not.toContain('Copy public link');
  });

  it('flag on with a URL: offers the copy-link action and "Turn off public link"', () => {
    const { target } = mountTable([asset({ publicLinkEnabled: true, publicUrl: URL_ON })]);
    const items = labels(menuItems(target));
    expect(items).toContain('Copy public link');
    expect(items).toContain('Turn off public link');
    expect(items).not.toContain('Turn on public link');
  });

  it('flag on but the server minted no URL: the switch is still offered, the copy action stays absent', () => {
    // publicUrl null is not proof the switch is off (no canonical origin, say).
    const items = labels(menuItems(mountTable([asset({ publicLinkEnabled: true, publicUrl: null })]).target));
    expect(items).toContain('Turn off public link');
    expect(items).not.toContain('Copy public link');
  });

  it('deployment gate off: no switch, whatever the flag says', () => {
    for (const publicLinkEnabled of [false, true]) {
      const items = labels(menuItems(mountTable([asset({ publicLinkAvailable: false, publicLinkEnabled })]).target));
      expect(items.some((i) => /public link/i.test(i ?? ''))).toBe(false);
    }
  });

  it('a reader the server does not let manage it: no switch', () => {
    const items = labels(menuItems(mountTable([asset({ canManagePublicLink: false })]).target));
    expect(items.some((i) => /Turn (on|off) public link/.test(i ?? ''))).toBe(false);
    // …and an existing link they were minted still copies, unchanged from #1020.
    const copy = labels(menuItems(mountTable([asset({ canManagePublicLink: false, publicUrl: URL_ON })]).target));
    expect(copy).toContain('Copy public link');
  });
});

describe('asset table: the confirmation', () => {
  it('turning it on states the consequence and sends nothing until confirmed', () => {
    const f = stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    expect(target.textContent).toContain('Anyone with the link can download this file, with no sign-in required.');
    expect(f.switchCalls()).toEqual([]);
  });

  it('cancelling sends nothing and restores the row\'s menu', () => {
    const f = stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Cancel')!.click();
    flushSync();
    expect(f.fn).not.toHaveBeenCalled();
    expect(target.querySelector('button[aria-label="Actions for notes.md"]')).not.toBeNull();
    expect(target.textContent).not.toContain('Anyone with the link');
  });

  it('Escape cancels too', () => {
    const f = stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    target.querySelector('[role="group"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(f.fn).not.toHaveBeenCalled();
    expect(target.textContent).not.toContain('Anyone with the link');
  });

  it('focuses Cancel, so Enter on a freshly opened panel cannot publish the file', () => {
    stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    expect(document.activeElement).toBe(button(target, 'Cancel'));
  });

  it('turning it off says the existing link stops working', () => {
    stubFetch(() => ({ status: 200, body: switched(false) }));
    const { target } = mountTable([asset({ publicLinkEnabled: true, publicUrl: URL_ON })]);
    pick(target, 'Turn off public link');
    expect(target.textContent).toContain('The existing link will stop working for everyone who has it.');
  });

  it('confirming sends one request with the asset and the direction', async () => {
    const f = stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Turn on')!.click();
    await settle();
    expect(f.switchCalls()).toEqual([{ assetId: 'asset-1', enabled: true }]);
  });

  it('is single-flight: a double click while the request is out sends one request', async () => {
    let release!: (r: Reply) => void;
    const f = stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    const go = button(target, 'Turn on')!;
    go.click();
    go.click();
    flushSync();
    expect(f.switchCalls()).toHaveLength(1);
    expect(go.disabled).toBe(true);
    release({ status: 200, body: switched(true) });
    await settle();
    expect(f.switchCalls()).toHaveLength(1);
  });
});

describe('asset table: after the server answers', () => {
  it('success moves the row to the server\'s state: copy-link appears, the switch flips, a status says so', async () => {
    stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Turn on')!.click();
    await settle();
    expect(target.textContent).toContain('Public link turned on.');
    const items = labels(menuItems(target));
    expect(items).toContain('Copy public link');
    expect(items).toContain('Turn off public link');
  });

  it('turning it off removes the copy-link action again', async () => {
    stubFetch(() => ({ status: 200, body: switched(false) }));
    const { target } = mountTable([asset({ publicLinkEnabled: true, publicUrl: URL_ON })]);
    pick(target, 'Turn off public link');
    button(target, 'Turn off')!.click();
    await settle();
    expect(target.textContent).toContain('Public link turned off.');
    const items = labels(menuItems(target));
    expect(items).not.toContain('Copy public link');
    expect(items).toContain('Turn on public link');
  });

  it('on with no URL to show says so rather than claiming a link exists', async () => {
    stubFetch(() => ({ status: 200, body: asset({ publicLinkEnabled: true, publicUrl: null }) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Turn on')!.click();
    await settle();
    expect(target.textContent).toContain('no link to show');
    expect(labels(menuItems(target))).not.toContain('Copy public link');
  });

  it('a refusal shows fixed copy, never the server\'s prose, and keeps the prior state', async () => {
    stubFetch(() => ({ status: 403, body: { code: 'PERMISSION_DENIED', message: 'caller does not manage this asset\'s memory' } }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Turn on')!.click();
    await settle();
    const alert = target.querySelector('[role="alert"]')!;
    expect(alert.textContent).toMatch(/was not changed/i);
    expect(target.textContent).not.toContain('does not manage');
    // Still the "on" question, still retryable; nothing says it worked.
    expect(target.textContent).not.toContain('Public link turned on');
    expect(button(target, 'Turn on')!.disabled).toBe(false);
  });

  it('an unknown error code is the generic failure, not a refusal, and shows no server text', async () => {
    stubFetch(() => ({ status: 500, body: { code: 'INTERNAL', message: 'the server had a problem' } }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Turn on')!.click();
    await settle();
    expect(target.querySelector('[role="alert"]')!.textContent).toMatch(/may not have changed/i);
    expect(target.textContent).not.toContain('the server had a problem');
  });

  it('a failed request can be retried and then succeeds', async () => {
    let n = 0;
    const f = stubFetch(() => (n++ === 0 ? { status: 500, body: { code: 'INTERNAL', message: 'x' } } : { status: 200, body: switched(true) }));
    const { target } = mountTable([asset()]);
    pick(target, 'Turn on public link');
    button(target, 'Turn on')!.click();
    await settle();
    button(target, 'Turn on')!.click();
    await settle();
    expect(f.switchCalls()).toHaveLength(2);
    expect(target.textContent).toContain('Public link turned on.');
  });

  it('teardown during the request throws nothing and writes nothing after unmount', async () => {
    let release!: (r: Reply) => void;
    stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const m = mountTable([asset()]);
    pick(m.target, 'Turn on public link');
    button(m.target, 'Turn on')!.click();
    flushSync();
    const caught = await captureUnhandledRejections(async () => {
      m.unmount();
      release({ status: 200, body: switched(true) });
      await settle();
    });
    expect(caught).toEqual([]);
  });

  it('teardown during a FAILING request throws nothing either', async () => {
    let release!: (r: Reply) => void;
    stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const m = mountTable([asset()]);
    pick(m.target, 'Turn on public link');
    button(m.target, 'Turn on')!.click();
    flushSync();
    const caught = await captureUnhandledRejections(async () => {
      m.unmount();
      release({ status: 403, body: { code: 'PERMISSION_DENIED', message: 'no' } });
      await settle();
    });
    expect(caught).toEqual([]);
  });
});

describe('asset table: the thumbnail follows the switch', () => {
  it('an image uses the URL the server returned after turning it on, and the authenticated route before', async () => {
    const f = stubFetch(() => ({ status: 200, body: asset({ mimeType: 'image/png', filename: 'pic.png', publicLinkEnabled: true, publicUrl: URL_ON }) }));
    // The authenticated route answers the presign the thumbnail asks for.
    const base = f.fn.getMockImplementation()! as (url: string, init?: { body: string }) => Promise<unknown>;
    f.fn.mockImplementation(async (url: string, init?: { body: string }) => {
      if (String(url).includes('/api/assets/download')) {
        return { ok: true, status: 200, statusText: '', json: async () => ({ url: 'https://store.example/presigned', expiresAt: null }) };
      }
      return base(url, init);
    });
    const m = mountComponent(AssetTable as never, { assets: [asset({ mimeType: 'image/png', filename: 'pic.png' })], showMemory: true } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await settle();
    expect(m.target.querySelector('img')?.getAttribute('src')).toBe('https://store.example/presigned');
    m.target.querySelector<HTMLButtonElement>('button[aria-label="Actions for pic.png"]')!.click();
    flushSync();
    [...m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Turn on public link')!.click();
    flushSync();
    button(m.target, 'Turn on')!.click();
    await settle();
    expect(m.target.querySelector('img')?.getAttribute('src')).toBe(URL_ON);
  });

  it('with the link off, a CLEAN image still previews through the authenticated route', async () => {
    const f = stubFetch(() => ({ status: 200, body: {} }));
    f.fn.mockImplementation(async (url: string) => ({
      ok: true, status: 200, statusText: '',
      json: async () => (String(url).includes('/api/assets/download') ? { url: 'https://store.example/presigned', expiresAt: null } : {}),
    }));
    const m = mountComponent(AssetTable as never, { assets: [asset({ mimeType: 'image/png', filename: 'pic.png', publicLinkEnabled: false, publicUrl: null })] } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await settle();
    expect(m.target.querySelector('img')?.getAttribute('src')).toBe('https://store.example/presigned');
  });
});

describe('node asset card', () => {
  it('shows the state and "Turn on public link" for a manager; nothing for anyone else', () => {
    const on = mountCard(asset());
    expect(on.target.textContent).toContain('Public link is off');
    expect(button(on.target, 'Turn on public link')).toBeDefined();
    for (const over of [{ canManagePublicLink: false }, { publicLinkAvailable: false }]) {
      const m = mountCard(asset(over));
      expect(m.target.textContent).not.toContain('Public link is');
      expect(button(m.target, 'Turn on public link')).toBeUndefined();
    }
  });

  it('confirms before sending; cancel sends nothing', () => {
    const f = stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountCard(asset());
    button(target, 'Turn on public link')!.click();
    flushSync();
    expect(target.textContent).toContain('Anyone with the link can download this file, with no sign-in required.');
    expect(f.fn).not.toHaveBeenCalled();
    button(target, 'Cancel')!.click();
    flushSync();
    expect(f.fn).not.toHaveBeenCalled();
    expect(button(target, 'Turn on public link')).toBeDefined();
  });

  it('on success: the state flips, the copy-link button appears, a status says so', async () => {
    stubFetch(() => ({ status: 200, body: switched(true) }));
    const { target } = mountCard(asset());
    expect(target.querySelector('button[aria-label^="Copy public link"]')).toBeNull();
    button(target, 'Turn on public link')!.click();
    flushSync();
    button(target, 'Turn on')!.click();
    await settle();
    expect(target.textContent).toContain('Public link is on');
    expect(target.textContent).toContain('Public link turned on.');
    expect(target.querySelector('button[aria-label^="Copy public link"]')).not.toBeNull();
    expect(button(target, 'Turn off public link')).toBeDefined();
  });

  it('a refusal keeps the prior state and shows fixed copy', async () => {
    stubFetch(() => ({ status: 404, body: { code: 'NOT_FOUND', message: 'asset not found' } }));
    const { target } = mountCard(asset());
    button(target, 'Turn on public link')!.click();
    flushSync();
    button(target, 'Turn on')!.click();
    await settle();
    expect(target.querySelector('[role="alert"]')!.textContent).toMatch(/was not changed/i);
    expect(target.textContent).not.toContain('asset not found');
    expect(target.querySelector('button[aria-label^="Copy public link"]')).toBeNull();
  });

  it('single-flight on the card too', async () => {
    let release!: (r: Reply) => void;
    const f = stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const { target } = mountCard(asset());
    button(target, 'Turn on public link')!.click();
    flushSync();
    const go = button(target, 'Turn on')!;
    go.click();
    go.click();
    flushSync();
    expect(f.switchCalls()).toHaveLength(1);
    release({ status: 200, body: switched(true) });
    await settle();
  });
});

describe('a refetch or navigation while the request is out', () => {
  function mountHost(kind: 'table' | 'card', initial: AssetSummary[]) {
    const m = mountComponent(Host as never, { kind, initial } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    return m;
  }
  const setAssets = (m: Mounted<Record<string, unknown>>, next: AssetSummary[]) => {
    (m.instance.setAssets as (a: AssetSummary[]) => void)(next);
    flushSync();
  };

  it('table: a late answer does not overwrite a newer refetch of the row', async () => {
    let release!: (r: Reply) => void;
    stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const m = mountHost('table', [asset()]);
    pick(m.target, 'Turn on public link');
    button(m.target, 'Turn on')!.click();
    flushSync();
    // The list refetched meanwhile and already says the link is on, with a newer URL.
    setAssets(m, [asset({ publicLinkEnabled: true, publicUrl: 'https://hadron.example/assets/newer' })]);
    release({ status: 200, body: switched(true) });
    await settle();
    expect(m.target.querySelector('button[aria-label^="Copy public link"]')).toBeNull();
    expect(m.target.textContent).not.toContain('Public link turned on.');
  });

  it('card: a late answer for asset A never replaces asset B after navigation', async () => {
    let release!: (r: Reply) => void;
    const f = stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const m = mountHost('card', [asset()]);
    button(m.target, 'Turn on public link')!.click();
    flushSync();
    button(m.target, 'Turn on')!.click();
    flushSync();
    setAssets(m, [asset({ id: 'asset-2', filename: 'other.md' })]);
    // B shows its own fresh state, not A's open confirmation.
    expect(m.target.textContent).toContain('other.md');
    expect(m.target.textContent).toContain('Public link is off');
    expect(button(m.target, 'Turn on')).toBeUndefined();
    release({ status: 200, body: switched(true) });
    await settle();
    expect(m.target.textContent).toContain('other.md');
    expect(m.target.textContent).not.toContain('notes.md');
    expect(m.target.textContent).toContain('Public link is off');
    expect(f.switchCalls()).toEqual([{ assetId: 'asset-1', enabled: true }]);
  });

  it('card: a late answer does not overwrite a newer refetch of the same asset', async () => {
    let release!: (r: Reply) => void;
    stubFetch(() => new Promise<Reply>((r) => (release = r)));
    const m = mountHost('card', [asset()]);
    button(m.target, 'Turn on public link')!.click();
    flushSync();
    button(m.target, 'Turn on')!.click();
    flushSync();
    const newer = asset({ publicLinkEnabled: true, publicUrl: 'https://hadron.example/assets/newer' });
    setAssets(m, [newer]);
    release({ status: 200, body: switched(true) });
    await settle();
    expect(m.target.textContent).not.toContain('Public link turned on.');
    expect(m.target.textContent).toContain('Public link is on');
  });

  it('table: row A\'s late answer applies to A and leaves row B\'s open panel and pending request alone', async () => {
    const releases: Array<(r: Reply) => void> = [];
    const f = stubFetch(() => new Promise<Reply>((r) => releases.push(r)));
    const a = asset();
    const b = asset({ id: 'asset-2', filename: 'other.md', urn: 'hrn:asset:hadronmemory.com:dev:assets:asset-2' });
    const { target } = mountTable([a, b]);
    const openRow = (file: string) => {
      target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${file}"]`)!.click();
      flushSync();
      [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')]
        .find((i) => i.textContent?.trim() === 'Turn on public link')!.click();
      flushSync();
      button(target, 'Turn on')!.click();
      flushSync();
    };
    openRow('notes.md');
    openRow('other.md');
    expect(f.switchCalls()).toHaveLength(2);
    releases[0]({ status: 200, body: switched(true) });
    await settle();
    // B's panel survived A's answer, with its request still out: no second send is possible.
    expect(button(target, 'Turn on')).toBeDefined();
    expect(button(target, 'Turn on')!.disabled).toBe(true);
    expect(f.switchCalls()).toHaveLength(2);
    releases[1]({ status: 200, body: switched(true) });
    await settle();
  });
});
