/**
 * portal#1742 — the Superforms stub the Invite clipboard harness aliases in
 * must fail LOUDLY when the component reaches for a field the stub does not
 * provide. Before this, drift read as silent `undefined` and the browser
 * script failed far away from the cause (or worse, passed vacuously).
 */
import { describe, expect, it } from 'vitest';
import { superForm, zod4Client } from './invite-copy-forms';

describe('invite-copy Superforms stub drift diagnostics (#1742)', () => {
  it('provides every field the Invite page destructures, with working stores', () => {
    const { form, errors, constraints, message, submitting, enhance } = superForm();
    expect(typeof form.subscribe).toBe('function');
    expect(typeof errors.subscribe).toBe('function');
    expect(typeof constraints.subscribe).toBe('function');
    expect(typeof message.subscribe).toBe('function');
    expect(typeof submitting.subscribe).toBe('function');
    expect(typeof enhance).toBe('function');
    form.subscribe((value) => { expect(value).toEqual({ inviteName: '', inviteEmail: '', inviteGithub: '' }); })();
  });

  it('throws a named drift error for a superForm field the stub lacks', () => {
    const seam = superForm() as unknown as Record<string, unknown>;
    expect(() => seam.invalidate).toThrowError(/Superforms stub drift.*\binvalidate\b/);
    expect(() => seam.debounced).toThrowError(/Superforms stub drift/);
  });

  it('does not throw for promise/protocol probes (then, symbols)', () => {
    const seam = superForm() as unknown as Record<string, unknown>;
    expect(seam.then).toBeUndefined();
    expect((seam as unknown as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive]).toBeUndefined();
  });

  it('keeps the adapter stub inert for the validators option', () => {
    expect(zod4Client()).toEqual({});
  });
});
