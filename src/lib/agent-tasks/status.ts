import { t } from '$lib/i18n/t';
import type { AgentTaskParty, AgentTaskRow, AgentTaskStatus } from './types';

/**
 * portal#1052 — one display state per task, shared by the board, the subtask
 * tree and the detail page (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §3).
 *
 * The words are the CLI's and the specs': backlog, queued, pending, started,
 * finished, cancelled. Backlog, Queued and Pending are three different chips
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:02): backlog is parked, queued
 * is in play with nobody on it, pending has an assignee. "Waiting on subtasks"
 * is a second chip, never a status.
 *
 * Exhaustive: a status the portal doesn't know renders its raw value with the
 * word "Unknown". No fallback branch claims a known state
 * (hrn:node:hadronmemory.com:hadron-portal:review:widening-a-union-recruits-every-fallback).
 */
export type TaskDisplayState = 'backlog' | 'queued' | 'pending' | 'started' | 'finished' | 'cancelled' | 'unknown';

export function taskDisplayState(task: Pick<AgentTaskRow, 'status' | 'queued'>): TaskDisplayState {
  switch (task.status as string) {
    case 'BACKLOG':
      return 'backlog';
    case 'PENDING':
      return task.queued ? 'queued' : 'pending';
    case 'STARTED':
      return 'started';
    case 'FINISHED':
      return 'finished';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

/** The chip's word. An unknown status shows its raw value beside "Unknown". */
export function taskStateLabel(state: TaskDisplayState, rawStatus?: string): string {
  switch (state) {
    case 'backlog':
      return t('app.tasks.state.backlog', 'Backlog');
    case 'queued':
      return t('app.tasks.state.queued', 'Queued');
    case 'pending':
      return t('app.tasks.state.pending', 'Pending');
    case 'started':
      return t('app.tasks.state.started', 'Started');
    case 'finished':
      return t('app.tasks.state.finished', 'Finished');
    case 'cancelled':
      return t('app.tasks.state.cancelled', 'Cancelled');
    case 'unknown':
      return t('app.tasks.state.unknown', 'Unknown: {raw}', { raw: rawStatus ?? '?' });
  }
}

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';

/** Tone is a second cue only: every chip carries its word. */
export function taskStateChipClass(state: TaskDisplayState): string {
  switch (state) {
    case 'backlog':
      // Dashed outline: parked, not in play.
      return `${CHIP} border border-dashed border-zinc-400 text-zinc-600 dark:border-zinc-500 dark:text-zinc-300`;
    case 'queued':
      return `${CHIP} border border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300`;
    case 'pending':
      return `${CHIP} bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200`;
    case 'started':
      return `${CHIP} bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200`;
    case 'finished':
      return `${CHIP} bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200`;
    case 'cancelled':
      return `${CHIP} bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`;
    case 'unknown':
      return `${CHIP} border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300`;
  }
}

export const WAITING_CHIP_CLASS = `${CHIP} border border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300`;

export function waitingOnSubtasksLabel(): string {
  return t('app.tasks.state.waiting-on-subtasks', 'Waiting on subtasks');
}

/** A finished task's outcome word, toned: failed is red, the rest neutral. Team strings render verbatim. */
export function outcomeClass(outcome: string): string {
  if (outcome === 'failed') return 'text-red-700 dark:text-red-300';
  if (outcome === 'succeeded') return 'text-green-700 dark:text-green-300';
  return 'text-zinc-700 dark:text-zinc-300';
}

/** A party's display name: the name, else the id, never blank. Branch on `id`, never on `name`. */
export function partyName(p: AgentTaskParty): string {
  return p.name?.trim() || p.id;
}

/** The text a party contributes to search: its name and, for a worker, its URN. */
export function partySearchText(p: AgentTaskParty | null): string {
  if (!p) return '';
  return [partyName(p), p.kind === 'WORKER' ? (p.urn ?? '') : ''].join(' ').trim();
}

/** The board's status filters (§4). Backlog is its own filter and is not in Active. */
export const BOARD_FILTERS = ['active', 'queued', 'backlog', 'ended', 'all'] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];

export function parseBoardFilter(raw: string | null): BoardFilter {
  return (BOARD_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as BoardFilter) : 'active';
}

/** The server arguments a filter reads with. */
export function boardFilterArgs(filter: BoardFilter): { status?: AgentTaskStatus[]; queued?: boolean } {
  switch (filter) {
    case 'active':
      return { status: ['PENDING', 'STARTED'] };
    case 'queued':
      return { queued: true };
    case 'backlog':
      return { status: ['BACKLOG'] };
    case 'ended':
      return { status: ['FINISHED', 'CANCELLED'] };
    case 'all':
      return {};
  }
}

export function boardFilterLabel(filter: BoardFilter): string {
  switch (filter) {
    case 'active':
      return t('app.tasks.filter.active', 'Active');
    case 'queued':
      return t('app.tasks.filter.queued', 'Queued');
    case 'backlog':
      return t('app.tasks.filter.backlog', 'Backlog');
    case 'ended':
      return t('app.tasks.filter.ended', 'Ended');
    case 'all':
      return t('app.tasks.filter.all', 'All');
  }
}

/** §8: an empty filter says which filter is empty. All-empty says the App has no tasks. */
export function boardEmptyText(filter: BoardFilter): string {
  switch (filter) {
    case 'active':
      return t('app.tasks.empty.active', 'No active tasks.');
    case 'queued':
      return t('app.tasks.empty.queued', 'Nothing queued.');
    case 'backlog':
      return t('app.tasks.empty.backlog', 'No backlog tasks.');
    case 'ended':
      return t('app.tasks.empty.ended', 'No ended tasks.');
    case 'all':
      return t(
        'app.tasks.empty.all',
        'No tasks in this App yet. Tasks are created with the CLI or MCP for now, e.g. `hadron team task create`.',
      );
  }
}

/**
 * How a task's free-text `source` renders: only an http(s) URL becomes a link
 * (never `javascript:` or another scheme), an `hrn:` string becomes the URN
 * chip, anything else stays text.
 */
export function sourceKind(source: string): 'url' | 'urn' | 'text' {
  const s = source.trim();
  if (/^https?:\/\/\S+$/i.test(s)) return 'url';
  if (/^hrn:\S+$/.test(s)) return 'urn';
  return 'text';
}
