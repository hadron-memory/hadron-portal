import { describe, expect, it } from 'vitest';
import { deleteWorkerFailureRefusal } from './delete-worker';

// portal#2227 — the shared delete refusal mapper adopts retire's
// unknown-outcome convention: a lost response (transport), a codeless GraphQL
// error or an unrecognized code can come AFTER the server committed the
// one-way delete, so the answer is 502 `uncertain: true` with a reload-first
// sentence — never a definite "failed" a retry would contradict. The four
// known refusal codes keep their own definite answers.
describe('deleteWorkerFailureRefusal — unknown outcome vs definite refusal', () => {
  const sentences = { failed: 'Could not confirm deletion. Refresh and try again.' };
  const transport = () => new Error('transport failure with private variables');
  const gql = (code: string | null, message = 'Server refusal sentence.') =>
    code === null
      ? { response: { errors: [{ message: 'codeless server error' }] } }
      : { response: { errors: [{ message, extensions: { code } }] } };

  it('answers a lost response as an unknown outcome, never a definite failure', () => {
    const refusal = deleteWorkerFailureRefusal(transport(), 'w1', sentences);
    expect(refusal.status).toBe(502);
    expect(refusal.result).toMatchObject({
      ok: false, workerRef: 'w1', uncertain: true, code: null,
      message: 'The delete may have succeeded. Reload to see the current state.',
    });
    expect(JSON.stringify(refusal)).not.toContain('private variables');
  });

  it('answers a codeless GraphQL error and an unrecognized code the same way', () => {
    for (const e of [gql(null), gql('INTERNAL_SERVER_ERROR', 'private internal diagnostic')]) {
      const refusal = deleteWorkerFailureRefusal(e, 'w1', sentences);
      expect(refusal.status).toBe(502);
      expect(refusal.result.uncertain).toBe(true);
      expect(JSON.stringify(refusal)).not.toContain('private internal diagnostic');
    }
  });

  it.each(['FORBIDDEN', 'WORKER_NOT_FOUND', 'WORKER_IN_USE', 'WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED'])(
    'keeps %s a definite refusal with no uncertain key',
    code => {
      const refusal = deleteWorkerFailureRefusal(gql(code), 'w1', {
        ...sentences,
        inUse: 'This worker has history — retire it instead.',
        forbidden: 'Staffing refusal sentence.',
      });
      expect(refusal.result.uncertain).toBeUndefined();
      expect(refusal.status).toBe(
        code === 'FORBIDDEN' ? 403 : code === 'WORKER_NOT_FOUND' ? 404 : 400);
    },
  );

  // portal#2260 round 1, Gil F2 — isDefiniteRefusal is wider than the four
  // known codes: the framework/access set (UNAUTHENTICATED, BAD_USER_INPUT,
  // NOT_FOUND) and any `*_NOT_FOUND` also prove the refusal came before any
  // commit, so retry is correct for them. A definite refusal must keep the
  // refusal shape — its class status below 500 (the mapper's own convention:
  // only a refusal carries the server sentence) — not fall through to a
  // 500 that reads as the server's own failure.
  it.each([
    ['UNAUTHENTICATED', 401],
    ['BAD_USER_INPUT', 400],
    ['NOT_FOUND', 404],
    ['APP_NOT_FOUND', 404],
  ])('answers the definite refusal %s as %i, never an unknown-outcome-shaped 500', (code, status) => {
    const refusal = deleteWorkerFailureRefusal(gql(code), 'w1', sentences);
    expect(refusal.result.uncertain).toBeUndefined();
    expect(refusal.result.code).toBe(code);
    expect(refusal.status).toBe(status);
  });

  // portal#2223 F6 — the whole mapping in one table: each definite code's
  // status AND sentence, with the redaction rule (the server's WORKER_IN_USE
  // text never surfaces when the page voices its own; the fixed sentence does).
  const SERVER = 'Server sentence.';
  const pageSentences = { ...sentences, inUse: 'Fixed retire-instead sentence.', forbidden: 'Fixed staffing sentence.' };
  it.each([
    ['FORBIDDEN', 403, 'Fixed staffing sentence.'],
    ['UNAUTHENTICATED', 401, SERVER],
    ['WORKER_NOT_FOUND', 404, SERVER],
    ['NOT_FOUND', 404, SERVER],
    ['APP_NOT_FOUND', 404, SERVER],
    ['WORKER_IN_USE', 400, 'Fixed retire-instead sentence.'],
    ['WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED', 400, SERVER],
    ['BAD_USER_INPUT', 400, SERVER],
  ])('maps %s to %i with the right sentence', (code, status, message) => {
    const refusal = deleteWorkerFailureRefusal(gql(code, SERVER), 'w1', pageSentences);
    expect(refusal).toEqual({ status, result: { ok: false, workerRef: 'w1', message, code } });
  });
  it('keeps the server sentences for WORKER_IN_USE and FORBIDDEN when the page voices none (the roster)', () => {
    for (const code of ['WORKER_IN_USE', 'FORBIDDEN']) {
      expect(deleteWorkerFailureRefusal(gql(code, SERVER), 'w1', sentences).result.message).toBe(SERVER);
    }
  });
  it('never surfaces the server WORKER_IN_USE text when the page voices its own', () => {
    const refusal = deleteWorkerFailureRefusal(gql('WORKER_IN_USE', 'private reference census: 14 runs'), 'w1', pageSentences);
    expect(JSON.stringify(refusal)).not.toContain('census');
  });

  it('lets a page voice its own uncertain sentence over the shared default', () => {
    const refusal = deleteWorkerFailureRefusal(transport(), 'w1', {
      ...sentences, uncertain: 'Page-specific reload-first sentence.',
    });
    expect(refusal.status).toBe(502);
    expect(refusal.result.message).toBe('Page-specific reload-first sentence.');
  });
});
