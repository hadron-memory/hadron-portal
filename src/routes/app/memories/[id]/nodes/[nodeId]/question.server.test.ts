/**
 * portal#2234 (Questions P1) — the node page's question loader branch and its
 * three form actions. The server (hadron-server#4427) judges who may answer;
 * the portal sends the revision it showed and maps refusals by known code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY, QUESTION_BY_REF_QUERY, QUESTION_CARD_FIELDS } from '$lib/server/queries';
import { selectsFieldPath } from '$lib/test/graphql-selection';
import { questionRefusal } from '$lib/questions/refusal';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'q', name: 'q', revision: 4, nodeType: 'info', role: 'question',
  alias: null, description: null, content: null, tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
  isRunnable: null, createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
};
const QUESTION = { id: 'q-1', code: 'Q1', title: 'Which?', state: 'OPEN', revSeq: 7, viewerMayAnswer: true, options: [] };

function gqlError(code: string, message = 'server prose with secrets') {
  return new ClientError({ errors: [{ message, extensions: { code } }] as never, status: 200, headers: new Headers() } as never, { query: '' });
}
function serve(node: Record<string, unknown>, question: () => unknown) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    if (doc === QUESTION_BY_REF_QUERY) return question();
    return { memories: { items: [], total: 0 } };
  });
}
function loadEvent() {
  return {
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'q' }], graph: { urn: 'hrn:mem:acme.com:mem-a' }, isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as never;
}
const questionCalls = () => mockRequest.mock.calls.filter(([d]) => d === QUESTION_BY_REF_QUERY);

describe('question loader', () => {
  it('reads the card only for a node whose role is question, and returns it ok', async () => {
    serve(NODE, () => ({ question: QUESTION }));
    const { load } = await import('./+page.server');
    const data = (await load(loadEvent())) as unknown as { question: unknown };
    expect(data.question).toEqual({ kind: 'ok', value: QUESTION });
    expect(questionCalls()[0][1]).toEqual({ ref: 'leaf-pk' });
  });
  it('makes no question request for any other role', async () => {
    serve({ ...NODE, role: 'spec' }, () => ({ question: QUESTION }));
    const { load } = await import('./+page.server');
    const data = (await load(loadEvent())) as unknown as { question: unknown };
    expect(data.question).toBeNull();
    expect(questionCalls()).toHaveLength(0);
  });
  it('a throwing read is failed, never an empty card', async () => {
    serve(NODE, () => { throw new Error('boom'); });
    const { load } = await import('./+page.server');
    expect(((await load(loadEvent())) as unknown as { question: unknown }).question).toEqual({ kind: 'failed' });
  });
  it('a null question for a node the page loaded is failed', async () => {
    serve(NODE, () => ({ question: null }));
    const { load } = await import('./+page.server');
    expect(((await load(loadEvent())) as unknown as { question: unknown }).question).toEqual({ kind: 'failed' });
  });
});

type Action = (ev: never) => Promise<unknown>;
async function act(name: string, fields: Record<string, string>, locals: Record<string, unknown> = { token: 'tok' }) {
  const { actions } = await import('./+page.server');
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const ev = {
    request: new Request('http://localhost/x', { method: 'POST', body }),
    params: { id: 'mem-A', nodeId: 'leaf-pk' }, locals, url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
  } as never;
  return (actions as unknown as Record<string, Action>)[name](ev) as Promise<{ status?: number; data?: Record<string, unknown>; kind?: string; ok?: boolean }>;
}
const writes = () => mockRequest.mock.calls;

describe('answerQuestion', () => {
  it('one click sends the option, the revision and via PORTAL', async () => {
    mockRequest.mockResolvedValue({ answerQuestion: QUESTION });
    const r = await act('answerQuestion', { optionKey: 'A', revision: '7' });
    expect(r).toMatchObject({ kind: 'answerQuestion', ok: true });
    expect(writes()[0][1]).toEqual({ ref: 'leaf-pk', expectedRevision: 7, input: { optionKey: 'A', via: 'PORTAL' } });
  });
  it('text only sends text and no optionKey', async () => {
    mockRequest.mockResolvedValue({ answerQuestion: QUESTION });
    await act('answerQuestion', { text: '  hello  ', revision: '7' });
    expect(writes()[0][1]).toEqual({ ref: 'leaf-pk', expectedRevision: 7, input: { text: 'hello', via: 'PORTAL' } });
  });
  it('neither option nor text fails 400 with no request', async () => {
    const r = await act('answerQuestion', { text: '   ', revision: '7' });
    expect(r.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it('a missing or malformed revision fails 400 with no request', async () => {
    expect((await act('answerQuestion', { optionKey: 'A' })).status).toBe(400);
    expect((await act('answerQuestion', { optionKey: 'A', revision: 'x' })).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe('retractQuestionAnswer and withdrawQuestion', () => {
  it('a retraction sends via PORTAL, and the reason only when one was given', async () => {
    mockRequest.mockResolvedValue({ retractQuestionAnswer: QUESTION });
    await act('retractQuestionAnswer', { revision: '7' });
    expect(writes()[0][1]).toEqual({ ref: 'leaf-pk', expectedRevision: 7, via: 'PORTAL' });
    await act('retractQuestionAnswer', { revision: '7', reason: 'wrong one' });
    expect(writes()[1][1]).toEqual({ ref: 'leaf-pk', expectedRevision: 7, via: 'PORTAL', reason: 'wrong one' });
  });
  it('a withdrawal requires a reason', async () => {
    mockRequest.mockResolvedValue({ withdrawQuestion: QUESTION });
    expect((await act('withdrawQuestion', { revision: '7' })).status).toBe(400);
    expect(writes()).toHaveLength(0);
    await act('withdrawQuestion', { revision: '7', reason: 'moot' });
    expect(writes()[0][1]).toEqual({ ref: 'leaf-pk', expectedRevision: 7, reason: 'moot' });
  });
});

describe('every action', () => {
  for (const name of ['answerQuestion', 'retractQuestionAnswer', 'withdrawQuestion']) {
    it(`${name}: impersonation fails 403 with no request`, async () => {
      const r = await act(name, { optionKey: 'A', revision: '7', reason: 'x' }, { token: 'tok', impersonation: { userId: 'u' } });
      expect(r.status).toBe(403);
      expect(writes()).toHaveLength(0);
    });
    it(`${name}: no token redirects to sign-in`, async () => {
      await expect(act(name, { optionKey: 'A', revision: '7', reason: 'x' }, {})).rejects.toMatchObject({ status: 303 });
      expect(writes()).toHaveLength(0);
    });
  }
});

describe('refusal map', () => {
  const table: [string, number][] = [
    ['NODE_WRITE_CONFLICT', 409], ['QUESTION_NOT_DECIDER', 403], ['QUESTION_IMPERSONATION_REFUSED', 403], ['QUESTION_UNKNOWN_OPTION', 409],
    ['QUESTION_NOT_ANSWERED', 409], ['QUESTION_WITHDRAWN', 409], ['QUESTION_INVALID', 400], ['QUESTION_NOT_FOUND', 404],
  ];
  for (const [code, status] of table) {
    it(`${code} maps to fixed text and ${status}, never the server's prose`, async () => {
      mockRequest.mockRejectedValue(gqlError(code));
      const r = await act('answerQuestion', { optionKey: 'A', revision: '7' });
      expect(r.status).toBe(status);
      expect(JSON.stringify(r.data)).not.toContain('server prose');
      expect(r.data?.error).toBe(questionRefusal(code)?.text);
    });
  }
  it('conflict and unknown option ask the client to reload', async () => {
    mockRequest.mockRejectedValue(gqlError('NODE_WRITE_CONFLICT'));
    expect((await act('answerQuestion', { optionKey: 'A', revision: '7' })).data?.reload).toBe(true);
    mockRequest.mockRejectedValue(gqlError('QUESTION_NOT_DECIDER'));
    expect((await act('answerQuestion', { optionKey: 'A', revision: '7' })).data?.reload).toBe(false);
  });
  it('QUESTION_INVALID text does not claim "empty or too long"', () => {
    expect(questionRefusal('QUESTION_INVALID')?.text).toBe('The answer could not be recorded. Reload the question and check it.');
  });
  it('an unknown code gives generic text, not the server message', async () => {
    mockRequest.mockRejectedValue(gqlError('SOMETHING_NEW', 'leaky internal detail'));
    const r = await act('answerQuestion', { optionKey: 'A', revision: '7' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.data)).not.toContain('leaky');
  });
});

describe('card query selection', () => {
  const doc = QUESTION_BY_REF_QUERY;
  for (const path of [['question', 'viewerMayAnswer'], ['question', 'revSeq'], ['question', 'answers', 'kind'], ['question', 'options', 'whyNot']]) {
    it(`selects ${path.join('.')}`, () => expect(selectsFieldPath(doc, 'QuestionCard', path)).toBe(true));
  }
  it('is built from the shared fragment', () => expect(doc).toContain(QUESTION_CARD_FIELDS));
});
