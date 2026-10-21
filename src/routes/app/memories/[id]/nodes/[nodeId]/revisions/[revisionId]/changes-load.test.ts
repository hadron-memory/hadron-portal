/**
 * #1001 — the revision page streams what the edit that replaced a snapshot
 * changed. A snapshot is the PRE-edit state, so the diff runs from it to the
 * next-newer snapshot, or to the live node for the newest one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODE_LIVE_CONTENT_QUERY,
  NODE_REVISION_PROVENANCE_QUERY,
  NODE_REVISION_QUERY,
  NODE_REVISIONS_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { load } from './+page.server';

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const HISTORY = [
  { id: 'r3', createdAt: '2026-03-01T00:00:00Z' },
  { id: 'r2', createdAt: '2026-02-01T00:00:00Z' },
  { id: 'r1', createdAt: '2026-01-01T00:00:00Z' },
];
const CONTENT: Record<string, string> = { r1: 'a\nb\n', r2: 'a\nB\n', r3: 'a\nB\nc\n' };

function serve(opts: { history?: unknown; live?: unknown; failHistory?: boolean } = {}) {
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, string>) => {
    if (doc === NODE_REVISION_QUERY) {
      return { nodeRevision: { id: vars.revisionId, loc: 'x', name: 'x', tags: [], createdAt: '', content: CONTENT[vars.revisionId] } };
    }
    if (doc === NODE_REVISIONS_QUERY) {
      if (opts.failHistory) throw new Error('boom');
      return { nodeRevisions: opts.history ?? HISTORY };
    }
    if (doc === NODE_LIVE_CONTENT_QUERY) return { node: opts.live ?? { id: 'n', content: 'a\nB\nc\nd\n' } };
    if (doc === NODE_REVISION_PROVENANCE_QUERY) return { nodeRevision: null };
    throw new Error(`unexpected document: ${doc.slice(0, 40)}`);
  });
}

async function changesFor(revisionId: string) {
  const out = (await load({
    params: { id: 'm', nodeId: 'n', revisionId },
    locals: { token: 't' },
  } as never)) as { changes: Promise<unknown> };
  return out.changes;
}

describe('revision page: changes', () => {
  it('diffs a middle snapshot against the next-NEWER snapshot', async () => {
    serve();
    expect(await changesFor('r1')).toMatchObject({
      ok: true,
      against: 'revision',
      state: 'diff',
      changed: true,
      lines: [
        { kind: 'same', text: 'a' },
        { kind: 'removed', text: 'b' },
        { kind: 'added', text: 'B' },
      ],
    });
  });

  it('diffs the newest snapshot against the live node', async () => {
    serve();
    expect(await changesFor('r3')).toMatchObject({
      ok: true,
      against: 'current',
      state: 'diff',
      lines: [
        { kind: 'same', text: 'a' },
        { kind: 'same', text: 'B' },
        { kind: 'same', text: 'c' },
        { kind: 'added', text: 'd' },
      ],
    });
  });

  it('says unknown, not a multi-edit diff, when the snapshot is not in the history list', async () => {
    serve({ history: [HISTORY[0]] });
    expect(await changesFor('r1')).toEqual({ ok: true, against: 'unknown' });
  });

  it('does not diff against a withheld (null) live body', async () => {
    serve({ live: { id: 'n', content: null } });
    expect(await changesFor('r3')).toEqual({ ok: true, against: 'current', state: 'unavailable' });
  });

  it('keeps a node that cannot be read apart from an unreadable body', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === NODE_REVISION_QUERY) return { nodeRevision: { id: 'r3', content: 'a', loc: 'x', name: 'x', tags: [], createdAt: '' } };
      if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: HISTORY };
      if (doc === NODE_LIVE_CONTENT_QUERY) return { node: null };
      return { nodeRevision: null };
    });
    expect(await changesFor('r3')).toEqual({ ok: false });
  });

  it('resolves to ok:false on a failed read, never rejecting the page', async () => {
    serve({ failHistory: true });
    expect(await changesFor('r1')).toEqual({ ok: false });
  });
});
