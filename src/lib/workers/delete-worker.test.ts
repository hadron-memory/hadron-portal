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

  it('lets a page voice its own uncertain sentence over the shared default', () => {
    const refusal = deleteWorkerFailureRefusal(transport(), 'w1', {
      ...sentences, uncertain: 'Page-specific reload-first sentence.',
    });
    expect(refusal.status).toBe(502);
    expect(refusal.result.message).toBe('Page-specific reload-first sentence.');
  });
});
