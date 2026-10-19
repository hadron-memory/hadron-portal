/**
 * portal#1142 P4 (hadron-server#1602 / #2120) — the worker's signature and
 * trailer templates. Own form and action; only changed fields are sent; text
 * is never null; refusals are the server's (FORBIDDEN, BAD_USER_INPUT,
 * WORKER_RETIRED) and the posted draft comes back with them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_WORKER_SIGNATURE_MUTATION, WORKER_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ sessions: [], teamWorkItems: { items: [], total: 0 } });
});

const SIG = '— [{{worker.name}}, {{worker.role}}]({{worker.url}}) · {{session.llmModel}}';
const TRL = 'Worker: {{worker.name}} ({{worker.role}}) <{{worker.url}}>';

const WORKER = {
  id: 'w-1', appId: 'app-1', agentId: 'agent-1', name: 'Dara', slug: 'dara', role: 'engineer',
  urn: 'hrn:worker:hadronmemory.com:team:dara', promptOverride: null, prompt: null, retiredAt: null,
  signature: SIG, trailer: TRL, app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
};

function gqlError(code: string, message: string) {
  return Object.assign(new Error('raw ClientError text'), { response: { errors: [{ message, extensions: { code } }] } });
}

async function runLoad(worker: Record<string, unknown>) {
  mockRequest.mockResolvedValueOnce({ worker });
  const { load } = await import('./+page.server');
  return (await load({
    params: { id: 'w-1' },
    url: new URL('http://localhost/app/workers/w-1'),
    locals: { user: { id: 'u1' }, token: 'tok' },
  } as never)) as unknown as { signatureForm: { data: Record<string, unknown> } };
}

async function runAction(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set('_kind', 'updateSignature');
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const { actions } = await import('./+page.server');
  return (actions as Record<string, (e: never) => Promise<unknown>>).updateSignature({
    params: { id: 'w-1' },
    locals: { user: { id: 'u1' }, token: 'tok' },
    request: { formData: async () => fd },
  } as never) as Promise<{ status?: number; data?: { form?: { data: Record<string, unknown>; message?: { type: string; text: string } } } }>;
}

const writes = () => mockRequest.mock.calls.filter(([q]) => q === UPDATE_WORKER_SIGNATURE_MUTATION);

describe('worker signature: query and mutation', () => {
  it('reads the signature and trailer on the worker page query', () => {
    expect(WORKER_QUERY).toMatch(/\bsignature\b/);
    expect(WORKER_QUERY).toMatch(/\btrailer\b/);
  });

  it('the mutation writes only signature and trailer, never promptOverride', () => {
    expect(UPDATE_WORKER_SIGNATURE_MUTATION).toMatch(/updateWorker\(/);
    expect(UPDATE_WORKER_SIGNATURE_MUTATION).not.toMatch(/promptOverride/);
  });
});

describe('worker signature: load', () => {
  it('seeds both templates as stored, with their bases', async () => {
    const data = await runLoad(WORKER);
    expect(data.signatureForm.data).toMatchObject({ signature: SIG, trailer: TRL, signatureBase: SIG, trailerBase: TRL });
  });
});

describe('worker signature: save sends changed fields only', () => {
  it('sends only the changed field', async () => {
    mockRequest.mockResolvedValueOnce({ updateWorker: { id: 'w-1' } });
    await runAction({ signature: 'new sig', signatureBase: SIG, trailer: TRL, trailerBase: TRL });
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toEqual({ workerRef: 'w-1', signature: 'new sig' });
  });

  it('sends both when both changed', async () => {
    mockRequest.mockResolvedValueOnce({ updateWorker: { id: 'w-1' } });
    await runAction({ signature: 's', signatureBase: SIG, trailer: 't', trailerBase: TRL });
    expect(writes()[0][1]).toEqual({ workerRef: 'w-1', signature: 's', trailer: 't' });
  });

  it('makes no request when nothing changed', async () => {
    await runAction({ signature: SIG, signatureBase: SIG, trailer: TRL, trailerBase: TRL });
    expect(writes()).toHaveLength(0);
  });

  it('sends an emptied template as text, never null or omitted', async () => {
    mockRequest.mockResolvedValueOnce({ updateWorker: { id: 'w-1' } });
    await runAction({ signature: '', signatureBase: SIG, trailer: '   ', trailerBase: TRL });
    expect(writes()[0][1]).toEqual({ workerRef: 'w-1', signature: '', trailer: '   ' });
  });

  it('a field the page did not show (masked) is never sent', async () => {
    mockRequest.mockResolvedValueOnce({ updateWorker: { id: 'w-1' } });
    await runAction({ signature: 'changed', signatureBase: SIG });
    expect(writes()[0][1]).toEqual({ workerRef: 'w-1', signature: 'changed' });
    expect(writes()[0][1]).not.toHaveProperty('trailer');
  });
});

describe('worker signature: refusals keep the draft', () => {
  const changed = { signature: 'my draft', signatureBase: SIG, trailer: TRL, trailerBase: TRL };

  it('FORBIDDEN: a fixed line that gives no reason', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
    const res = await runAction(changed);
    expect(res.status).toBe(403);
    expect(res.data?.form?.message).toEqual({ type: 'error', text: "You can't change this worker's signature or trailer." });
    expect(res.data?.form?.data.signature).toBe('my draft');
  });

  it('BAD_USER_INPUT: the server message, whole', async () => {
    const text = 'Signature and trailer must be text, at most 2000 characters, without NUL bytes; use an empty string to deliver nothing.';
    mockRequest.mockRejectedValueOnce(gqlError('BAD_USER_INPUT', text));
    const res = await runAction(changed);
    expect(res.status).toBe(400);
    expect(res.data?.form?.message).toEqual({ type: 'error', text });
    expect(res.data?.form?.data.signature).toBe('my draft');
  });

  it('WORKER_RETIRED: the server message', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('WORKER_RETIRED', 'This worker is retired.'));
    const res = await runAction(changed);
    expect(res.status).toBe(400);
    expect(res.data?.form?.message?.text).toBe('This worker is retired.');
  });

  it('anything else: the generic line, never the raw ClientError text', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'db down'));
    const res = await runAction(changed);
    expect(res.status).toBe(500);
    expect(res.data?.form?.message?.text).toBe("The signature and trailer couldn't be saved.");
    expect(res.data?.form?.data.signature).toBe('my draft');
  });
});
