/**
 * portal#2436 (BLIND review): pressing Delete replaces the Delete button with the confirmation, which
 * would drop focus to the page. The prompt takes focus, so it is read out and Delete and Cancel are next.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import Detail from './[secretId]/+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const secret = { id: 's1', ownerType: 'app', ownerId: 'app-1', name: 'stripe-key', kind: 'generic', metadata: null, protected: false, currentVersion: 2, createdAt: '2026-11-01T00:00:00Z', createdBy: 'u1', updatedAt: '2026-11-02T00:00:00Z', updatedBy: 'u1' };
const data = { app, secret, signing: 'on', pending: [], impersonating: null };
const mountWith = (form: unknown) => mountComponent(Detail as never, { data, form } as never);
const prompt = (t: HTMLElement) => t.querySelector('[data-testid="delete-confirm"]') as HTMLElement | null;

afterEach(() => { document.body.innerHTML = ''; });

describe('the delete confirmation takes focus', () => {
  it('when the server asked, focus is on the prompt, and Delete (confirm) and Cancel follow it', () => {
    const m = mountWith({ action: 'delete', confirm: true });
    flushSync();
    const p = prompt(m.target)!;
    expect(p).not.toBeNull();
    expect(document.activeElement).toBe(p);
    const stops = [...m.target.querySelectorAll<HTMLElement>('input[name="confirm"] ~ button, input[name="confirm"] ~ a')].map((e) => e.textContent?.trim());
    expect(stops).toEqual(['Delete', 'Cancel']);
    m.unmount();
  });
  it('with no confirmation asked, nothing takes focus', () => {
    const m = mountWith(null);
    flushSync();
    expect(prompt(m.target)).toBeNull();
    expect(m.target.contains(document.activeElement)).toBe(false);
    m.unmount();
  });
  it("another action's result does not open it or move focus", () => {
    const m = mountWith({ action: 'update', ok: true });
    flushSync();
    expect(prompt(m.target)).toBeNull();
    expect(m.target.contains(document.activeElement)).toBe(false);
    m.unmount();
  });
});
