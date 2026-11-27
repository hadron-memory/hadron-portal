import { describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { cloneRefusal } from './clone-refusal';
import { sendCommentWrite } from './comments';

/** #2569 (C3): the doors that are plain functions. Route doors carry their pins beside their `page.server.test.ts`. */
function refusal(ext: Record<string, unknown>, message: string): ClientError {
  return new ClientError({ status: 200, errors: [{ message, extensions: ext }] } as never, { query: 'mutation {x}' });
}
const reached = refusal({ code: 'OWNER_LIMIT_REACHED', limitKey: 'agents', ownerType: 'organization', callerCanManageOwner: false }, 'The owner of this memory has reached a limit of their account.');

describe('agent clone (door 8, ruling C3-R3)', () => {
  it('is 409 with the server text and no blockers (on main: 503, "Could not clone the Agent")', () => {
    const r = cloneRefusal(reached);
    expect(r).toEqual({ status: 409, text: 'The owner of this memory has reached a limit of their account.' });
    expect('blockers' in r).toBe(false);
  });
  it('still maps its known codes and keeps the generic fixed copy for an unknown one', () => {
    expect(cloneRefusal(refusal({ code: 'AGENT_URN_TAKEN' }, 'x'))).toMatchObject({ status: 409, field: 'slug' });
    expect(cloneRefusal(refusal({ code: 'SOMETHING_NEW' }, 'secret detail'))).toMatchObject({ status: 503 });
  });
});

describe('comment save (door 18)', () => {
  it('answers a node-size refusal as 400 with the server text and code', async () => {
    const client = { request: vi.fn().mockRejectedValue(refusal({ code: 'NODE_CONTENT_TOO_LARGE', maxBytes: 100 }, 'A node can hold at most 100 bytes.')) };
    const r = await sendCommentWrite(client as never, 'n1', { op: 'create', body: 'x', anchorRevision: 1 } as never);
    expect(r).toEqual({ ok: false, status: 400, text: 'A node can hold at most 100 bytes.', code: 'NODE_CONTENT_TOO_LARGE' });
  });
});
