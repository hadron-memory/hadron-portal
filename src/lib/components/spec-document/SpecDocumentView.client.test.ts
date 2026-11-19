import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import SpecDocumentView from './SpecDocumentView.svelte';
import * as renderer from '$lib/markdown/spec-document-renderer';

const MD = '<a id="cor-agt-110"></a>\n\n# Feature é ✓\r\n\n## Part\n\ntext & <b>bold</b>\n';
let writeText: ReturnType<typeof vi.fn>;
let blobs: Blob[];
let downloads: Array<{ name: string; href: string }>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:test/1'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SpecDocumentView', () => {
  it('renders the markdown after mount, anchors included', async () => {
    const m = mountComponent(SpecDocumentView, { markdown: MD, loc: 'cor:agt:110', name: 'F' });
    flushSync(); await tick();
    expect(m.target.querySelector('#cor-agt-110')).not.toBeNull();
    expect(m.target.querySelector('h1')?.textContent).toContain('Feature');
    m.unmount();
  });
  it('re-renders when the markdown prop changes on the mounted component (in-route navigation)', async () => {
    const props = reactiveProps({ markdown: '# Alpha doc\n', loc: 'a:b', name: 'A' });
    const m = mountComponent(SpecDocumentView, props);
    flushSync(); await tick();
    expect(m.target.querySelector('h1')?.textContent).toContain('Alpha');
    props.markdown = '# Beta doc\n';
    flushSync(); await tick(); flushSync();
    expect(m.target.querySelector('h1')?.textContent).toContain('Beta');
    expect(m.target.querySelector('h1')?.textContent).not.toContain('Alpha');
    m.unmount();
  });
  it('makes every rendered code block keyboard-reachable and named, and the body a named region', async () => {
    const m = mountComponent(SpecDocumentView, { markdown: '```\nlong line\n```\n', loc: 'a:b', name: 'F' });
    flushSync(); await tick(); flushSync();
    const pre = m.target.querySelector('[data-testid=spec-document-rendered] pre');
    expect(pre?.getAttribute('tabindex')).toBe('0');
    expect(pre?.getAttribute('aria-label')).toBeTruthy();
    expect(m.target.querySelector('[data-testid=spec-document-body]')?.getAttribute('role')).toBe('region');
    m.unmount();
  });
  it('clears the Copied status after a few seconds, and not after unmount', async () => {
    vi.useFakeTimers();
    try {
      const m = mountComponent(SpecDocumentView, { markdown: MD, loc: 'a:b', name: 'F' });
      flushSync();
      (m.target.querySelector('[data-testid=spec-document-copy]') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(10); flushSync();
      const status = () => m.target.querySelector('[data-testid=spec-document-copy-status]')?.textContent ?? '';
      expect(status()).toContain('Copied');
      await vi.advanceTimersByTimeAsync(5000); flushSync();
      expect(status().trim()).toBe('');
      m.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('copies the response string exactly, not the rendered text', async () => {
    const m = mountComponent(SpecDocumentView, { markdown: MD, loc: 'cor:agt:110', name: 'F' });
    flushSync(); await tick();
    (m.target.querySelector('[data-testid=spec-document-copy]') as HTMLButtonElement).click();
    await tick(); flushSync();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe(MD);
    expect(m.target.querySelector('[data-testid=spec-document-copy-status]')?.textContent).toContain('Copied');
    m.unmount();
  });
  it('says so when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const m = mountComponent(SpecDocumentView, { markdown: MD, loc: 'cor:agt:110', name: 'F' });
    flushSync();
    (m.target.querySelector('[data-testid=spec-document-copy]') as HTMLButtonElement).click();
    await tick(); flushSync();
    expect(m.target.querySelector('[data-testid=spec-document-copy-status]')?.textContent).toContain('Couldn');
    m.unmount();
  });
  it('downloads bytes identical to the response, as text/markdown, under the loc filename', async () => {
    const m = mountComponent(SpecDocumentView, { markdown: MD, loc: 'cor:agt:110', name: 'F' });
    flushSync();
    (m.target.querySelector('[data-testid=spec-document-download]') as HTMLButtonElement).click();
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/markdown;charset=utf-8');
    expect(Array.from(new Uint8Array(await blobs[0].arrayBuffer()))).toEqual(Array.from(new TextEncoder().encode(MD)));
    expect(downloads).toEqual([{ name: 'cor-agt-110.md', href: 'blob:test/1' }]);
    m.unmount();
  });
  it('a render failure shows the raw text escaped, with Copy and Download still working', async () => {
    vi.spyOn(renderer, 'renderSpecDocument').mockImplementation(() => { throw new Error('parse blew up'); });
    const m = mountComponent(SpecDocumentView, { markdown: MD, loc: 'cor:agt:110', name: 'F' });
    flushSync(); await tick(); flushSync();
    const raw = m.target.querySelector('[data-testid=spec-document-raw]') as HTMLElement;
    expect(raw.textContent).toBe(MD);
    expect(raw.querySelector('b')).toBeNull();
    (m.target.querySelector('[data-testid=spec-document-copy]') as HTMLButtonElement).click();
    await tick();
    expect(writeText.mock.calls[0][0]).toBe(MD);
    (m.target.querySelector('[data-testid=spec-document-download]') as HTMLButtonElement).click();
    expect(blobs).toHaveLength(1);
    m.unmount();
  });
});
