/**
 * portal#1921 (hadron-server#3894, #2973 PR 2) — the org boot-prompt signing
 * switch: read, drained preview, switch on/off.
 *
 * Contract per the merged SDL (hadron-server a1ba6d33); rulings R1-R5 on the
 * issue. The server is the gate: FORBIDDEN is `hidden`, everything else that
 * is not a success is `failed`, and no server text is ever returned.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  loadOrgSigningSwitch,
  loadSigningPreview,
  setOrgSigning,
  PREVIEW_PAGE_SIZE,
  PREVIEW_MAX_PAGES,
} from './org-boot-prompt-signing';
import {
  ORG_BOOT_PROMPT_SIGNING_QUERY,
  ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY,
  SET_ORG_BOOT_PROMPT_SIGNING_MUTATION,
  ORG_PROFILE_QUERY,
} from './queries';

const gqlErr = (code: string) => ({ response: { errors: [{ message: 'server prose that must never surface', extensions: { code } }] } });
const row = (n: number, over: Record<string, unknown> = {}) => ({
  appId: `app-${n}`,
  appUrn: `hrn:app:acme.com:app-${n}`,
  agentId: `agent-${n}`,
  agentName: `Agent ${n}`,
  workerId: null,
  workerName: null,
  compiledNodeId: `node-${n}`,
  compiledNodeUrn: `hrn:node:acme.com:m:boot-${n}`,
  servedRevSeq: 3,
  state: 'UNSIGNED_STOPS',
  changesToRevSeq: null,
  ...over,
});
type Page = { rows: unknown[]; total: number; hasMore: boolean; endCursor: string | null; previewToken: string };
const page = (rows: unknown[], over: Partial<Page> = {}): Page => ({
  rows,
  total: rows.length,
  hasMore: false,
  endCursor: null,
  previewToken: 'tok-1',
  ...over,
});
const wrap = (p: Page) => ({ orgBootPromptSigningPreview: { enforced: false, deploymentSigns: true, ...p } });
const client = (impl: (q: string, v: Record<string, unknown>) => unknown) =>
  ({ request: vi.fn(async (q: string, v: Record<string, unknown>) => impl(q, v)) }) as never;
const calls = (c: never) => (c as unknown as { request: { mock: { calls: [string, Record<string, unknown>][] } } }).request.mock.calls;

describe('the read is its own request (never folded into the profile query)', () => {
  it('sends orgBootPromptSigning(org) on its own document', async () => {
    const c = client(() => ({ orgBootPromptSigning: { required: true, enforced: false, deploymentSigns: false } }));
    const r = await loadOrgSigningSwitch(c, 'org-1');
    expect(r).toEqual({ kind: 'ok', required: true, enforced: false, deploymentSigns: false });
    expect(calls(c)[0][0]).toBe(ORG_BOOT_PROMPT_SIGNING_QUERY);
    expect(calls(c)[0][1]).toEqual({ org: 'org-1' });
    expect(ORG_PROFILE_QUERY).not.toContain('orgBootPromptSigning');
  });

  it('FORBIDDEN is hidden, never failed and never a throw', async () => {
    const r = await loadOrgSigningSwitch(client(() => { throw gqlErr('FORBIDDEN'); }), 'org-1');
    expect(r).toEqual({ kind: 'hidden' });
  });

  it('a transport failure and any other code are failed, not hidden', async () => {
    expect(await loadOrgSigningSwitch(client(() => { throw new Error('socket'); }), 'org-1')).toEqual({ kind: 'failed' });
    expect(await loadOrgSigningSwitch(client(() => { throw gqlErr('INTERNAL_SERVER_ERROR'); }), 'org-1')).toEqual({ kind: 'failed' });
    expect(await loadOrgSigningSwitch(client(() => { throw gqlErr('BOOT_PROMPT_SIGNING_NOT_CONFIGURED'); }), 'org-1')).toEqual({ kind: 'failed' });
  });

  it('logs the code only, never the server prose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadOrgSigningSwitch(client(() => { throw gqlErr('INTERNAL_SERVER_ERROR'); }), 'org-1');
    const logged = warn.mock.calls.flat().join(' ');
    warn.mockRestore();
    expect(logged).toContain('INTERNAL_SERVER_ERROR');
    expect(logged).not.toContain('server prose');
  });
});

describe('the preview drains every page (R3)', () => {
  it('reads at first:200 and stops on hasMore:false', async () => {
    const c = client(() => wrap(page([row(1), row(2)])));
    const r = await loadSigningPreview(c, 'org-1');
    expect(r.kind).toBe('ok');
    expect(calls(c)).toHaveLength(1);
    expect(calls(c)[0][0]).toBe(ORG_BOOT_PROMPT_SIGNING_PREVIEW_QUERY);
    expect(calls(c)[0][1]).toEqual({ org: 'org-1', first: PREVIEW_PAGE_SIZE, after: null });
    expect(PREVIEW_PAGE_SIZE).toBe(200);
  });

  it('follows endCursor across pages and returns all rows', async () => {
    const c = client((_q, v) =>
      v.after === null
        ? wrap(page([row(1)], { total: 2, hasMore: true, endCursor: 'c1', previewToken: 'tok-first' }))
        : wrap(page([row(2)], { total: 2, previewToken: 'tok-last' })),
    );
    const r = await loadSigningPreview(c, 'org-1');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.rows.map((x) => x.appId)).toEqual(['app-1', 'app-2']);
    expect(calls(c)[1][1]).toEqual({ org: 'org-1', first: 200, after: 'c1' });
  });

  it('keeps the FIRST page token, not the last (R3)', async () => {
    const c = client((_q, v) =>
      v.after === null
        ? wrap(page([row(1)], { total: 2, hasMore: true, endCursor: 'c1', previewToken: 'tok-first' }))
        : wrap(page([row(2)], { total: 2, previewToken: 'tok-last' })),
    );
    const r = await loadSigningPreview(c, 'org-1');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.previewToken).toBe('tok-first');
  });

  it('above the bound it reports too_many with the total and offers no rows', async () => {
    let n = 0;
    const c = client(() => {
      n += 1;
      return wrap(page([row(n)], { total: 5000, hasMore: true, endCursor: `c${n}` }));
    });
    const r = await loadSigningPreview(c, 'org-1');
    expect(r).toMatchObject({ kind: 'too_many', total: 5000 });
    expect(calls(c)).toHaveLength(PREVIEW_MAX_PAGES);
    expect(PREVIEW_MAX_PAGES).toBe(10);
  });

  it('a repeated cursor is drift, and the drain gives up after one retry', async () => {
    const c = client(() => wrap(page([row(1)], { total: 2, hasMore: true, endCursor: 'same' })));
    expect(await loadSigningPreview(c, 'org-1')).toEqual({ kind: 'drifted' });
  });

  it('a total that changes between pages is drift', async () => {
    const c = client((_q, v) =>
      v.after === null
        ? wrap(page([row(1)], { total: 2, hasMore: true, endCursor: 'c1' }))
        : wrap(page([row(2)], { total: 3 })),
    );
    expect(await loadSigningPreview(c, 'org-1')).toEqual({ kind: 'drifted' });
  });

  it('a final row count that is not total is drift', async () => {
    const c = client(() => wrap(page([row(1)], { total: 4 })));
    expect(await loadSigningPreview(c, 'org-1')).toEqual({ kind: 'drifted' });
  });

  it('an empty preview still carries its token', async () => {
    const r = await loadSigningPreview(client(() => wrap(page([], { previewToken: 'tok-empty' }))), 'org-1');
    expect(r).toMatchObject({ kind: 'ok', total: 0, rows: [], previewToken: 'tok-empty' });
  });

  it('FORBIDDEN is hidden; a stale-cursor BAD_USER_INPUT and transport are failed', async () => {
    expect(await loadSigningPreview(client(() => { throw gqlErr('FORBIDDEN'); }), 'org-1')).toEqual({ kind: 'hidden' });
    expect(await loadSigningPreview(client(() => { throw gqlErr('BAD_USER_INPUT'); }), 'org-1')).toEqual({ kind: 'failed' });
    expect(await loadSigningPreview(client(() => { throw new Error('socket'); }), 'org-1')).toEqual({ kind: 'failed' });
  });
});

describe('switching on and off', () => {
  const ok = { setOrgBootPromptSigning: { required: true, enforced: true, deploymentSigns: true } };

  it('on sends the token it was given and required:true', async () => {
    const c = client(() => ok);
    const r = await setOrgSigning(c, 'org-1', { required: true, previewToken: 'tok-1' });
    expect(r).toEqual({ kind: 'ok', required: true, enforced: true, deploymentSigns: true });
    expect(calls(c)[0][0]).toBe(SET_ORG_BOOT_PROMPT_SIGNING_MUTATION);
    expect(calls(c)[0][1]).toEqual({ org: 'org-1', required: true, previewToken: 'tok-1' });
  });

  it('off sends no previewToken key at all', async () => {
    const c = client(() => ({ setOrgBootPromptSigning: { required: false, enforced: false, deploymentSigns: true } }));
    await setOrgSigning(c, 'org-1', { required: false });
    expect(calls(c)[0][1]).toEqual({ org: 'org-1', required: false });
    expect('previewToken' in calls(c)[0][1]).toBe(false);
  });

  it('BOOT_PROMPT_SIGNING_PREVIEW_STALE is stale', async () => {
    const r = await setOrgSigning(client(() => { throw gqlErr('BOOT_PROMPT_SIGNING_PREVIEW_STALE'); }), 'org-1', { required: true, previewToken: 't' });
    expect(r).toEqual({ kind: 'stale' });
  });

  it('FORBIDDEN is hidden and carries no server text', async () => {
    const r = await setOrgSigning(client(() => { throw gqlErr('FORBIDDEN'); }), 'org-1', { required: true, previewToken: 't' });
    expect(r).toEqual({ kind: 'hidden' });
  });

  it('the impersonation 403 and any other failure are failed with no prose', async () => {
    const r = await setOrgSigning(client(() => { throw { response: { status: 403, errors: [{ message: 'prose', extensions: { code: 'IMPERSONATION_READ_ONLY' } }] } }; }), 'org-1', { required: false });
    expect(r).toEqual({ kind: 'failed' });
    expect(JSON.stringify(r)).not.toContain('prose');
  });
});
