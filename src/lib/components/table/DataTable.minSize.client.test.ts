import { afterEach, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import Harness from '$lib/test/DataTableMinSizeHarness.svelte';
let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());
it('declared column minimum controls restored sizing, keyboard resize and ARIA; legacy keyboard floor stays40', () => {
 const m = mountComponent(Harness, {}); cleanup = m.unmount; flushSync();
 ([...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Restore undersized view') as HTMLButtonElement).click(); flushSync();
 const [action, legacy] = [...m.target.querySelectorAll('[role="separator"]')];
 expect(action.getAttribute('aria-valuenow')).toBe('120');
 expect(action.getAttribute('aria-valuemin')).toBe('120');
 action.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); flushSync();
 expect(action.getAttribute('aria-valuenow')).toBe('120');
 action.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); flushSync();
 expect(action.getAttribute('aria-valuenow')).toBe('130');
 for (let i=0; i<20; i++) { legacy.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); flushSync(); }
 expect(legacy.getAttribute('aria-valuemin')).toBe('40');
 expect(legacy.getAttribute('aria-valuenow')).toBe('40');
});
