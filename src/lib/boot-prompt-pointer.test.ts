/**
 * portal#1142 S8 — how a boot-prompt pointer reads (hadron-server#2219;
 * Xylon's stamp 6330444824): a null pair is "not shown", a failed read is its
 * own state, an App row borrows nothing from another, and every refusal code
 * the setters return has a fixed lead.
 */
import { describe, expect, it } from 'vitest';
import { appRowPointer, pointerRefusalLead, pointerText, pointerView } from './boot-prompt-pointer';

const URN = 'hrn:node:acme.com:team-sys:boot:compiled';

describe('pointerView', () => {
  it('a set pointer, a deleted target, a null pair and a failed read are four states', () => {
    expect(pointerView({ ok: true, ref: URN, deleted: false })).toEqual({ kind: 'set', ref: URN });
    expect(pointerView({ ok: true, ref: URN, deleted: null })).toEqual({ kind: 'set', ref: URN });
    expect(pointerView({ ok: true, ref: URN, deleted: true })).toEqual({ kind: 'deleted', ref: URN });
    expect(pointerView({ ok: true, ref: null, deleted: null })).toEqual({ kind: 'not-shown' });
    expect(pointerView({ ok: false })).toEqual({ kind: 'unavailable' });
    expect(pointerView(undefined)).toEqual({ kind: 'unavailable' });
  });

  it('a masked read never reads as "no pointer"', () => {
    const text = pointerText({ ok: true, ref: null, deleted: null });
    expect(text).toBe('Not shown');
    expect(text).not.toMatch(/no pointer|none|not set/i);
  });
});

describe('appRowPointer', () => {
  const pointers = { ok: true as const, byAgent: { a1: { ref: URN, deleted: false } } };

  it('joins by agent id, and a row with no entry is not shown, never another row’s pointer', () => {
    expect(appRowPointer(pointers, 'a1')).toEqual({ ok: true, ref: URN, deleted: false });
    expect(appRowPointer(pointers, 'a2')).toEqual({ ok: true, ref: null, deleted: null });
    expect(pointerView(appRowPointer(pointers, 'a2')).kind).toBe('not-shown');
  });

  it('a failed or missing read is unavailable for every row', () => {
    expect(appRowPointer({ ok: false }, 'a1')).toEqual({ ok: false });
    expect(appRowPointer(undefined, 'a1')).toEqual({ ok: false });
  });
});

describe('pointerText', () => {
  it('is exactly what the cell shows, for the grid’s search', () => {
    expect(pointerText({ ok: true, ref: URN, deleted: false })).toBe(URN);
    expect(pointerText({ ok: true, ref: URN, deleted: true })).toBe(`${URN} target deleted`);
    expect(pointerText({ ok: false })).toBe('Couldn’t load the pointer.');
  });
});

describe('pointerRefusalLead', () => {
  it.each([
    ['BAD_USER_INPUT', 'That isn’t a node id or a fully-qualified node URN.'],
    ['AGENT_NOT_FOUND', 'It may have been removed. Reload the page.'],
    ['APP_NOT_FOUND', 'It may have been removed. Reload the page.'],
    ['WORKER_NOT_FOUND', 'It may have been removed. Reload the page.'],
    ['BOOT_PROMPT_POINTER_SESSION_REFUSED', 'Set it as yourself, not from a worker session.'],
    ['BOOT_PROMPT_POINTER_NOT_FOUND', 'That node wasn’t found, or you can’t read it.'],
    ['BOOT_PROMPT_POINTER_NOT_COMPILED', 'That node isn’t a compiled boot prompt.'],
    ['BOOT_PROMPT_POINTER_WRONG_ROLE', 'That node isn’t a boot prompt for this target.'],
    ['BOOT_PROMPT_POINTER_WRONG_MEMORY', 'That node isn’t a boot prompt for this target.'],
  ])('%s has a fixed lead', (code, lead) => {
    expect(pointerRefusalLead(code, 'agent')).toBe(lead);
  });

  it('FORBIDDEN names whose manager may change it', () => {
    expect(pointerRefusalLead('FORBIDDEN', 'agent')).toBe('Only this Agent’s manager can change its pointer.');
    expect(pointerRefusalLead('FORBIDDEN', 'app')).toBe('Only this App’s manager can change this pointer.');
  });

  it('an unknown code or no code has no lead', () => {
    expect(pointerRefusalLead('SOMETHING_ELSE', 'agent')).toBeNull();
    expect(pointerRefusalLead(null, 'app')).toBeNull();
  });

  it('no lead says why a node was unavailable', () => {
    expect(pointerRefusalLead('BOOT_PROMPT_POINTER_NOT_FOUND', 'agent')).not.toMatch(/deleted|missing|permission/i);
  });
});
