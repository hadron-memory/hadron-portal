/**
 * portal#1921 — the preview + switch-on route (R1 sub-route, R3 drain, R4).
 *
 * Strategy as the Profile loader tests: mock `$lib/server/api`'s gqlClient and
 * call `load` / `actions.switchOn` with a hand-rolled event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORG_BOOT_PROMPT_SIGNING_QUERY,
  ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY,
  SET_ORG_BOOT_PROMPT_SIGNING_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
beforeEach(() => {
  mockRequest.mockReset();
});

const gqlErr = (code: string) => ({ response: { errors: [{ message: 'server prose', extensions: { code } }] } });
const off = { orgBootPromptSigning: { required: false, enforced: false, deploymentSigns: true } };
const on = { orgBootPromptSigning: { required: true, enforced: true, deploymentSigns: true } };
const previewOf = (token: string, n = 1) => ({
  orgBootPromptSigningPreview: {
    enforced: false,
    deploymentSigns: true,
    total: n,
    hasMore: false,
    endCursor: null,
    previewToken: token,
    rows: Array.from({ length: n }, (_, i) => ({
      appId: `a${i}`, appUrn: `hrn:app:acme.com:a${i}`, agentId: `g${i}`, agentName: `Agent ${i}`,
      workerId: null, workerName: null, compiledNodeId: `n${i}`, compiledNodeUrn: null,
      servedRevSeq: 2, state: 'UNSIGNED_STOPS', changesToRevSeq: null,
    })),
  },
});
function route(by: Record<string, () => unknown>) {
  mockRequest.mockImplementation(async (doc: string) => {
    for (const [name, fn] of Object.entries(by)) if (doc.includes(name)) return fn();
    throw new Error(`unexpected document ${doc.slice(0, 40)}`);
  });
}
const mod = () => import('./+page.server');
const ev = () => ({ params: { id: 'org-1' }, locals: { token: 't' } }) as never;
function actEv(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return { params: { id: 'org-1' }, locals: { token: 't' }, request: { formData: async () => fd } } as never;
}
const docsSent = () => mockRequest.mock.calls.map((c) => String(c[0]));
const varsOf = (needle: string) => mockRequest.mock.calls.find((c) => String(c[0]).includes(needle))?.[1];

describe('load', () => {
  it('reads the switch then drains the preview when signing is off', async () => {
    route({ OrgBootPromptSigningPreview: () => previewOf('tok'), 'query OrgBootPromptSigning($org': () => off });
    const { load } = await mod();
    const r = (await load(ev())) as { sw: { kind: string }; preview: { kind: string; previewToken: string } };
    expect(r.sw.kind).toBe('ok');
    expect(r.preview).toMatchObject({ kind: 'ok', previewToken: 'tok' });
    expect(docsSent()).toContain(ORG_BOOT_PROMPT_SIGNING_QUERY);
    expect(docsSent()).toContain(ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY);
  });

  it('offers no preview once signing is already required (R5: no preview from that state)', async () => {
    route({ 'query OrgBootPromptSigning($org': () => on });
    const { load } = await mod();
    const r = (await load(ev())) as { preview: unknown };
    expect(r.preview).toBeNull();
    expect(docsSent()).not.toContain(ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY);
  });

  it('FORBIDDEN on the read is a 404, with no state word', async () => {
    route({ 'query OrgBootPromptSigning($org': () => { throw gqlErr('FORBIDDEN'); } });
    const { load } = await mod();
    await expect(load(ev())).rejects.toMatchObject({ status: 404 });
  });

  it('an outage is failed, not hidden, and loads no preview', async () => {
    route({ 'query OrgBootPromptSigning($org': () => { throw new Error('socket'); } });
    const { load } = await mod();
    const r = (await load(ev())) as { sw: { kind: string }; preview: unknown };
    expect(r.sw.kind).toBe('failed');
    expect(r.preview).toBeNull();
  });
});

describe('switchOn', () => {
  const setOk = { setOrgBootPromptSigning: { required: true, enforced: true, deploymentSigns: true } };

  it('posts the token from the preview shown, with required:true', async () => {
    route({ SetOrgBootPromptSigning: () => setOk });
    const { actions } = await mod();
    const r = await actions.switchOn(actEv({ previewToken: 'tok-shown' }));
    expect(r).toMatchObject({ outcome: 'done' });
    expect(varsOf(SET_ORG_BOOT_PROMPT_SIGNING_MUTATION)).toEqual({ orgRef: 'org-1', required: true, previewToken: 'tok-shown' });
  });

  it('never reads required from the form', async () => {
    route({ SetOrgBootPromptSigning: () => setOk });
    const { actions } = await mod();
    await actions.switchOn(actEv({ previewToken: 'tok', required: 'false' }));
    expect(varsOf(SET_ORG_BOOT_PROMPT_SIGNING_MUTATION).required).toBe(true);
  });

  it('refuses without a token and sends no mutation', async () => {
    const { actions } = await mod();
    for (const fields of [{} as Record<string, string>, { previewToken: '' }, { previewToken: '   ' }]) {
      const r = await actions.switchOn(actEv(fields));
      expect(r).toMatchObject({ status: 400, data: { outcome: 'no_review' } });
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('STALE reloads the preview with a fresh token, fixed copy, no server prose', async () => {
    route({
      SetOrgBootPromptSigning: () => { throw gqlErr('BOOT_PROMPT_SIGNING_PREVIEW_STALE'); },
      OrgBootPromptSigningPreview: () => previewOf('tok-fresh', 2),
    });
    const { actions } = await mod();
    const r = (await actions.switchOn(actEv({ previewToken: 'tok-old' }))) as { status: number; data: { outcome: string; preview: { previewToken: string; total: number } } };
    expect(r.data.outcome).toBe('stale');
    expect(r.data.preview).toMatchObject({ kind: 'ok', previewToken: 'tok-fresh', total: 2 });
    expect(JSON.stringify(r)).not.toContain('server prose');
    expect(docsSent().filter((d) => d === SET_ORG_BOOT_PROMPT_SIGNING_MUTATION)).toHaveLength(1);
  });

  it('FORBIDDEN is hidden and names nothing about the org', async () => {
    route({ SetOrgBootPromptSigning: () => { throw gqlErr('FORBIDDEN'); } });
    const { actions } = await mod();
    const r = await actions.switchOn(actEv({ previewToken: 'tok' }));
    expect(r).toMatchObject({ data: { outcome: 'hidden' } });
    expect(JSON.stringify(r)).not.toContain('server prose');
  });

  it('any other failure is failed with fixed copy only', async () => {
    route({ SetOrgBootPromptSigning: () => { throw gqlErr('BOOT_PROMPT_SIGNING_NOT_CONFIGURED'); } });
    const { actions } = await mod();
    const r = await actions.switchOn(actEv({ previewToken: 'tok' }));
    expect(r).toMatchObject({ data: { outcome: 'failed' } });
    expect(JSON.stringify(r)).not.toContain('server prose');
  });

  it('STALE whose reload is refused is hidden, not a blank card (code-review F1)', async () => {
    route({
      SetOrgBootPromptSigning: () => { throw gqlErr('BOOT_PROMPT_SIGNING_PREVIEW_STALE'); },
      OrgBootPromptSigningPreview: () => { throw gqlErr('FORBIDDEN'); },
    });
    const { actions } = await mod();
    const r = await actions.switchOn(actEv({ previewToken: 'tok-old' }));
    expect(r).toMatchObject({ status: 403, data: { outcome: 'hidden' } });
  });

  it('refuses an oversized token without a mutation (code-review F7)', async () => {
    const { actions } = await mod();
    const r = await actions.switchOn(actEv({ previewToken: 'x'.repeat(4097) }));
    expect(r).toMatchObject({ status: 400, data: { outcome: 'no_review' } });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('the preview read refused after the switch read succeeded is a 404 (Rico P3)', async () => {
    route({
      'query OrgBootPromptSigning($org': () => off,
      OrgBootPromptSigningPreview: () => { throw gqlErr('FORBIDDEN'); },
    });
    const { load } = await mod();
    await expect(load(ev())).rejects.toMatchObject({ status: 404 });
  });
});
