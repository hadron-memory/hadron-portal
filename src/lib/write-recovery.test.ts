/** portal#2195 blind delta F5 — an operation's callbacks cannot touch a newer operation's entry. */
import { afterEach, describe, expect, it, vi } from 'vitest';
const readback = vi.hoisted(() => ({ resolve: (_landed: boolean) => {} }));
vi.mock('$lib/readback-after-write', () => ({
  readbackAfterWrite: () => new Promise<boolean>((resolve) => { readback.resolve = resolve; }),
}));
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

  it.each([
    ['the loader shows the written value', 'B'],
    ['the loader shows another value', 'A'],
  ])('a readback that resolves after a newer entry replaced it leaves the newer entry alone when %s', async (_n, loaderValue) => {
    const first = beginWrite('k', 'B');
    const settling = settleCommittedWrite('k', first, 'B', true, () => loaderValue);
    expect(recoveryOf('k')).toMatchObject({ value: 'B', phase: 'pending' });
    resetWriteRecovery();
    const second = beginWrite('k', 'C');
    readback.resolve(true);
    await settling;
    expect(recoveryOf('k')).toMatchObject({ value: 'C', phase: 'inflight', token: second });
  });

  it('an uncertain outcome is kept as such through the readback until the loader shows the value', async () => {
    const token = beginWrite('k', 'B');
    const settling = settleCommittedWrite('k', token, 'B', true, () => 'A', true);
    expect(recoveryOf('k')).toMatchObject({ phase: 'pending', uncertain: true });
    readback.resolve(true);
    await settling;
    expect(recoveryOf('k')).toMatchObject({ value: 'B', phase: 'stale', uncertain: true });
  });

  it('a committed outcome is not marked uncertain', async () => {
    const token = beginWrite('k', 'B');
    const settling = settleCommittedWrite('k', token, 'B', true, () => 'A');
    readback.resolve(true);
    await settling;
    expect(recoveryOf('k')).toMatchObject({ phase: 'stale', uncertain: false });
  });
});
