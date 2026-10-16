/**
 * portal#1052 — the one display-state mapping the board, tree and detail page
 * share (design §3). Every server status is pinned, BACKLOG included, and an
 * unknown one never borrows a known state's word.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_FILTERS,
  boardEmptyText,
  boardFilterArgs,
  parseBoardFilter,
  partyName,
  sourceKind,
  taskDisplayState,
  taskStateChipClass,
  taskStateLabel,
  type TaskDisplayState,
} from './status';

describe('taskDisplayState', () => {
  it.each([
    ['BACKLOG', false, 'backlog'],
    ['PENDING', true, 'queued'],
    ['PENDING', false, 'pending'],
    ['STARTED', false, 'started'],
    ['FINISHED', false, 'finished'],
    ['CANCELLED', false, 'cancelled'],
  ] as const)('%s (queued=%s) is %s', (status, queued, state) => {
    expect(taskDisplayState({ status, queued })).toBe(state);
  });

  it('an unknown status is unknown, and its label carries the raw value', () => {
    const state = taskDisplayState({ status: 'PAUSED' as never, queued: false });
    expect(state).toBe('unknown');
    expect(taskStateLabel(state, 'PAUSED')).toBe('Unknown: PAUSED');
  });
});

describe('the chips', () => {
  const states: TaskDisplayState[] = ['backlog', 'queued', 'pending', 'started', 'finished', 'cancelled', 'unknown'];

  it('every state has its own word', () => {
    const labels = states.map((s) => taskStateLabel(s, 'X'));
    expect(new Set(labels).size).toBe(states.length);
    expect(labels.slice(0, 6)).toEqual(['Backlog', 'Queued', 'Pending', 'Started', 'Finished', 'Cancelled']);
  });

  it('backlog, queued and pending are three visibly different chips; backlog is dashed', () => {
    const [b, q, p] = (['backlog', 'queued', 'pending'] as const).map(taskStateChipClass);
    expect(new Set([b, q, p]).size).toBe(3);
    expect(b).toContain('border-dashed');
    expect(q).not.toContain('border-dashed');
  });
});

describe('the board filters', () => {
  it('maps each filter to its server arguments; backlog is its own filter, not part of active', () => {
    expect(boardFilterArgs('active')).toEqual({ status: ['PENDING', 'STARTED'] });
    expect(boardFilterArgs('queued')).toEqual({ queued: true });
    expect(boardFilterArgs('backlog')).toEqual({ status: ['BACKLOG'] });
    expect(boardFilterArgs('ended')).toEqual({ status: ['FINISHED', 'CANCELLED'] });
    expect(boardFilterArgs('all')).toEqual({});
  });

  it('an unknown or missing filter falls back to active', () => {
    expect(parseBoardFilter(null)).toBe('active');
    expect(parseBoardFilter('bogus')).toBe('active');
    expect(parseBoardFilter('backlog')).toBe('backlog');
  });

  it('each filter has its own empty text', () => {
    expect(new Set(BOARD_FILTERS.map(boardEmptyText)).size).toBe(BOARD_FILTERS.length);
    expect(boardEmptyText('backlog')).toBe('No backlog tasks.');
  });
});

describe('sourceKind', () => {
  it('links only http(s) URLs, chips hrn: references, and leaves the rest as text', () => {
    expect(sourceKind('https://github.com/o/r/issues/1')).toBe('url');
    expect(sourceKind('hrn:node:acme.com:mem:loc')).toBe('urn');
    expect(sourceKind('javascript:alert(1)')).toBe('text');
    expect(sourceKind('team chat #12')).toBe('text');
  });
});

it('partyName never renders blank', () => {
  expect(partyName({ id: 'w1', kind: 'WORKER', name: '  ', urn: null })).toBe('w1');
  expect(partyName({ id: 'u1', kind: 'USER', name: 'Holger', urn: null })).toBe('Holger');
});
