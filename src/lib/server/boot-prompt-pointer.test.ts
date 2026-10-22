/**
 * portal#1142 S8 — the server side of a pointer form (hadron-server#2219;
 * Xylon's stamp 6330444824): Set sends the typed text, Clear an explicit
 * null, an empty Set sends nothing; a refusal keeps the draft and the server's
 * message and never echoes the query or variables; the self-audit only hints.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { APP_BOOT_POINTERS_QUERY, SELF_CAN_MANAGE_QUERY } from './queries';
import { pointerAction, pointerNodeRef, pointerRefusal, readAppPointers, readPointer, selfCanManage } from './boot-prompt-pointer';

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const PRIVATE = 'mutation SetAgentBootPrompt PRIVATE-VARS';
const refused = (code: string | null, message = 'The server says no.') =>
  new ClientError(
    { data: null, errors: [{ message, ...(code ? { extensions: { code } } : {}) }] as never, status: 200, headers: new Headers(), body: PRIVATE },
    { query: PRIVATE, variables: { secret: 'PRIVATE-VARS' } },
  );

describe('pointerNodeRef', () => {
  it('Clear is an explicit null, whatever was typed', () => {
    expect(pointerNodeRef(fd({ intent: 'clear', nodeRef: 'x' }))).toEqual({ nodeRef: null });
  });
  it('Set sends the typed text, trimmed', () => {
    expect(pointerNodeRef(fd({ intent: 'set', nodeRef: '  hrn:node:a.com:m:boot  ' }))).toEqual({ nodeRef: 'hrn:node:a.com:m:boot' });
  });
  it('an empty Set is invalid: never read as a clear', () => {
    expect(pointerNodeRef(fd({ intent: 'set', nodeRef: '   ' }))).toEqual({ invalid: true, typed: '   ' });
    expect(pointerNodeRef(fd({}))).toEqual({ invalid: true, typed: '' });
  });
});

describe('pointerAction', () => {
  it('sends exactly the typed ref, and an explicit null for Clear', async () => {
    const write = vi.fn().mockResolvedValue({});
    expect(await pointerAction(fd({ intent: 'set', nodeRef: 'n1' }), 'agent', 'a1', write)).toEqual({ pointer: { key: 'a1', ok: true, cleared: false } });
    expect(write).toHaveBeenLastCalledWith('n1');
    expect(await pointerAction(fd({ intent: 'clear' }), 'agent', 'a1', write)).toEqual({ pointer: { key: 'a1', ok: true, cleared: true } });
    expect(write).toHaveBeenLastCalledWith(null);
    expect(write.mock.calls[1]).toHaveLength(1);
  });

  it('an empty Set writes nothing and keeps what was typed', async () => {
    const write = vi.fn();
    const r = (await pointerAction(fd({ intent: 'set', nodeRef: ' ' }), 'app', 'a1', write)) as { status: number; data: { pointer: Record<string, unknown> } };
    expect(write).not.toHaveBeenCalled();
    expect(r.status).toBe(400);
    expect(r.data.pointer).toMatchObject({ key: 'a1', nodeRef: ' ' });
  });

  it.each([
    ['BAD_USER_INPUT', 400],
    ['AGENT_NOT_FOUND', 404],
    ['APP_NOT_FOUND', 404],
    ['WORKER_NOT_FOUND', 404],
    ['FORBIDDEN', 403],
    ['BOOT_PROMPT_POINTER_SESSION_REFUSED', 403],
    ['BOOT_PROMPT_POINTER_NOT_FOUND', 400],
    ['BOOT_PROMPT_POINTER_NOT_COMPILED', 400],
    ['BOOT_PROMPT_POINTER_WRONG_ROLE', 400],
    ['BOOT_PROMPT_POINTER_WRONG_MEMORY', 400],
  ])('%s keeps the draft, the lead and the server message whole (%i)', async (code, status) => {
    const message = 'Node <img src=x onerror=alert(1)> {{x}} refused.';
    const r = (await pointerAction(fd({ intent: 'set', nodeRef: 'typed-ref' }), 'agent', 'a1', () => Promise.reject(refused(code, message)))) as {
      status: number;
      data: { pointer: { key: string; nodeRef: string; refusal: { code: string; lead: string; message: string } } };
    };
    expect(r.status).toBe(status);
    expect(r.data.pointer.key).toBe('a1');
    expect(r.data.pointer.nodeRef).toBe('typed-ref');
    expect(r.data.pointer.refusal.code).toBe(code);
    expect(r.data.pointer.refusal.lead).toBeTruthy();
    expect(r.data.pointer.refusal.message).toBe(message);
    expect(JSON.stringify(r.data)).not.toContain('PRIVATE-VARS');
  });

  it('an unknown code keeps the server message, with no lead', async () => {
    const r = (await pointerAction(fd({ nodeRef: 'n' }), 'app', 'k', () => Promise.reject(refused('SOMETHING_ELSE')))) as { data: { pointer: { refusal: { lead: unknown; message: string } } } };
    expect(r.data.pointer.refusal).toMatchObject({ lead: null, message: 'The server says no.' });
  });

  it('a payloadless or transport error shows a fixed line, never the thrown message (it carries the query)', async () => {
    for (const e of [new Error(PRIVATE), Object.assign(new Error(PRIVATE), { response: { errors: [{}] } }), refused(null, '')]) {
      const r = (await pointerAction(fd({ nodeRef: 'n' }), 'agent', 'k', () => Promise.reject(e))) as { status: number; data: { pointer: { refusal: { message: string } } } };
      expect(r.data.pointer.refusal.message).toBe('The pointer couldn’t be changed. Reload the page and try again.');
      expect(JSON.stringify(r.data)).not.toContain('PRIVATE-VARS');
    }
  });

  it('pointerRefusal reads the code from the error, not from the message', () => {
    expect(pointerRefusal(refused('FORBIDDEN', 'BOOT_PROMPT_POINTER_NOT_FOUND'), 'app')).toMatchObject({ code: 'FORBIDDEN', lead: 'Only this App’s manager can change this pointer.' });
  });
});

describe('selfCanManage', () => {
  it('is the self-audit’s answer, asked about the given URN as the viewer', async () => {
    const request = vi.fn().mockResolvedValue({ effectiveAccess: { canManage: false } });
    expect(await selfCanManage({ request } as never, 'u1', 'hrn:app:a.com:team')).toBe(false);
    expect(request).toHaveBeenCalledWith(SELF_CAN_MANAGE_QUERY, { user: 'u1', resource: 'hrn:app:a.com:team' });
    request.mockResolvedValueOnce({ effectiveAccess: { canManage: true } });
    expect(await selfCanManage({ request } as never, 'u1', 'hrn:app:a.com:team')).toBe(true);
  });

  it('is null (unknown) on a refusal, a failure, no viewer or no URN, and then asks nothing', async () => {
    const request = vi.fn().mockRejectedValue(refused('FORBIDDEN'));
    expect(await selfCanManage({ request } as never, 'u1', 'hrn:app:a.com:team')).toBeNull();
    request.mockReset();
    expect(await selfCanManage({ request } as never, null, 'hrn:app:a.com:team')).toBeNull();
    expect(await selfCanManage({ request } as never, 'u1', null)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('readPointer and readAppPointers', () => {
  it('a read that throws, or answers no owner, is unavailable, never a null pointer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readPointer(() => Promise.reject(new Error('x')), () => null, 't')).toEqual({ ok: false });
    expect(await readPointer(() => Promise.resolve({ agent: null }), (r) => r.agent, 't')).toEqual({ ok: false });
    expect(await readPointer(() => Promise.resolve({ agent: { bootPromptRef: null, bootPromptTargetDeleted: null } }), (r) => r.agent, 't')).toEqual({ ok: true, ref: null, deleted: null });
  });

  it('keys App install rows by agent id and leaves out a withheld agent', async () => {
    const request = vi.fn().mockResolvedValue({
      app: { appAgents: [
        { agent: { id: 'a1' }, bootPromptRef: 'hrn:node:a.com:m:p', bootPromptTargetDeleted: true },
        { agent: null, bootPromptRef: 'hrn:node:a.com:m:hidden', bootPromptTargetDeleted: false },
      ] },
    });
    expect(await readAppPointers({ request } as never, 'app-1')).toEqual({ ok: true, byAgent: { a1: { ref: 'hrn:node:a.com:m:p', deleted: true } } });
    expect(request).toHaveBeenCalledWith(APP_BOOT_POINTERS_QUERY, { ref: 'app-1' });
  });
});
