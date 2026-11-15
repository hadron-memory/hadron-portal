/** portal#2195 blind delta F5 — an operation's callbacks cannot touch a newer operation's entry. */
import { afterEach, describe, expect, it } from 'vitest';
import { beginWrite, failWrite, recoveryOf, resetWriteRecovery, settleCommittedWrite } from './write-recovery.svelte';

afterEach(() => resetWriteRecovery());

describe('write recovery from submission (F5)', () => {
  it('locks the owner the moment a write is submitted, before any response', () => {
    beginWrite('k', 'B');
    expect(recoveryOf('k')).toMatchObject({ value: 'B', phase: 'inflight' });
  });

  it('a failed write releases the lock, only for the operation that still owns the entry', () => {
    const a = beginWrite('k', 'B');
    failWrite('k', a);
    expect(recoveryOf('k')).toBeUndefined();
    const stale = beginWrite('k', 'B');
    resetWriteRecovery();
    const fresh = beginWrite('k', 'C');
    failWrite('k', stale);
    expect(recoveryOf('k')).toMatchObject({ value: 'C', phase: 'inflight' });
    failWrite('k', fresh);
    expect(recoveryOf('k')).toBeUndefined();
  });

  it('an obsolete settle neither clears nor overwrites a newer write\'s recovery', async () => {
    const first = beginWrite('k', 'B');
    resetWriteRecovery();
    beginWrite('k', 'C');
    await settleCommittedWrite('k', first, 'B', false, () => undefined);
    expect(recoveryOf('k')).toMatchObject({ value: 'C', phase: 'inflight' });
    const landed = beginWrite('j', 'B');
    resetWriteRecovery();
    const second = beginWrite('j', 'C');
    await settleCommittedWrite('j', landed, 'B', true, () => 'B');
    expect(recoveryOf('j')).toMatchObject({ value: 'C', phase: 'inflight' });
    expect(second).not.toBe(landed);
  });
});
