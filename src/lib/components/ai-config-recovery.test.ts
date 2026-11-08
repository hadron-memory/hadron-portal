import { beforeEach, describe, expect, it } from 'vitest';
import { getAiConfigRecoveryStore, resetAiConfigRecoveryForTests } from './ai-config-recovery';
import type { AiConfigCommitted } from './ai-config-manager';

const committed = (ownerKey: string, uncertainText?: string): AiConfigCommitted => ({
  ownerKey, noticeGeneration: -1, successText: '', refreshFailedText: '', uncertainText,
});

beforeEach(() => resetAiConfigRecoveryForTests());

describe('AI configuration recovery store', () => {
  it('keeps a newer deferred uncertainty when an older outcome completes later', () => {
    const store = getAiConfigRecoveryStore('u1');
    const older = committed('ORGANIZATION:o1');
    const newer = committed('ORGANIZATION:o1', 'uncertain');
    store.defer(older);
    store.defer(newer);
    store.defer(older);

    expect(store.takeDeferred('ORGANIZATION:o1')).toBe(newer);
    expect(store.takeDeferred('ORGANIZATION:o1')).toBeUndefined();
  });

  it('retains direct uncertainty within a user and isolates other users', () => {
    const first = getAiConfigRecoveryStore('u1');
    const second = getAiConfigRecoveryStore('u1');
    const other = getAiConfigRecoveryStore('u2');
    first.setUncertainty('ORGANIZATION:o1', 'uncertain');

    expect(second.uncertainty('ORGANIZATION:o1')).toBe('uncertain');
    expect(other.uncertainty('ORGANIZATION:o1')).toBeNull();
  });

  it('shares pending registrations within a user and isolates other users', () => {
    const first = getAiConfigRecoveryStore('u1');
    const second = getAiConfigRecoveryStore('u1');
    const other = getAiConfigRecoveryStore('u2');
    first.setPending({ ownerKey: 'ORGANIZATION:o1', mutationId: 1, pending: true });

    expect(second.pending()).toEqual([{ ownerKey: 'ORGANIZATION:o1', mutationId: 1 }]);
    expect(other.pending()).toEqual([]);
    second.setPending({ ownerKey: 'ORGANIZATION:o1', mutationId: 1, pending: false });
    expect(first.pending()).toEqual([]);
  });
});
