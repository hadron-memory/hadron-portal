import type { GraphQLClient } from 'graphql-request';
import { t } from '$lib/i18n/t';
import type { WriteRefusal } from '$lib/agent-tasks/actions';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { IMPERSONATION_SENTENCE } from '$lib/server/agent-task-writes';
import type {
  LiveStops,
  ManagesHint,
  StopLevel,
  StopRead,
  StopScope,
  StopSignal,
  StopSignalPage,
  WorkerOption,
} from '$lib/stop-signals/types';

/**
 * portal#1139 — the App's stop signals, as hadron-server S6 (#2166) ships them.
 *
 * Reading needs participation in the App (a reader outside it gets
 * APP_NOT_FOUND). Setting and lifting are whoever manages the App; the server
 * decides on every call and `App.viewerManages` is only a display hint.
 */

// Static documents: the GraphQL validator reads them, so no `${}` inside the gql.
export const TEAM_STOP_SIGNALS_QUERY = /* GraphQL */ `
  query TeamStopSignals($appRef: String!, $includeEnded: Boolean, $first: Int, $after: String) {
    teamStopSignals(appRef: $appRef, includeEnded: $includeEnded, first: $first, after: $after) {
      signals { id level scope targetWorkerId targetHostId setAt until setByUserId setByHostKey live endedAt endKind endedByUserId endedByHostKey }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const SET_TEAM_STOP_SIGNAL_MUTATION = /* GraphQL */ `
  mutation SetTeamStopSignal($input: SetTeamStopSignalInput!) {
    setTeamStopSignal(input: $input) { id level scope targetWorkerId targetHostId setAt until setByUserId setByHostKey live endedAt endKind endedByUserId endedByHostKey }
  }
`;

export const LIFT_TEAM_STOP_SIGNAL_MUTATION = /* GraphQL */ `
  mutation LiftTeamStopSignal($appRef: String!, $id: ID!) {
    liftTeamStopSignal(appRef: $appRef, id: $id) { changed signal { id level scope targetWorkerId targetHostId setAt until setByUserId setByHostKey live endedAt endKind endedByUserId endedByHostKey } }
  }
`;

export const APP_VIEWER_MANAGES_QUERY = /* GraphQL */ `
  query AppViewerManages($ref: ID!) {
    app(ref: $ref) { id viewerManages }
  }
`;

export const STOP_WORKERS_QUERY = /* GraphQL */ `
  query StopWorkers($appRef: ID!) {
    teamRoster(appRef: $appRef) { workers { worker { id name urn } } }
  }
`;

export const STOP_PEOPLE_QUERY = /* GraphQL */ `
  query StopPeople($ref: ID!) {
    app(ref: $ref) { members { user { id handle name } } }
  }
`;

/** The table's page size, and the banner's (the server's maximum). */
export const STOP_TABLE_PAGE = 50;
export const STOP_BANNER_PAGE = 200;
/** The banner follows at most this many pages, then says "at least N". */
export const STOP_BANNER_MAX_PAGES = 5;

export async function loadStopPage(client: GraphQLClient, appRef: string, after: string | null): Promise<StopRead<StopSignalPage>> {
  try {
    const r = await client.request<{ teamStopSignals: StopSignalPage }>(TEAM_STOP_SIGNALS_QUERY, {
      appRef,
      includeEnded: true,
      first: STOP_TABLE_PAGE,
      ...(after ? { after } : {}),
    });
    return { kind: 'ok', value: r.teamStopSignals };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'APP_NOT_FOUND') return { kind: 'not-participant' };
    console.warn(`[stop-signals] table read for ${appRef} failed:`, e);
    return { kind: 'failed' };
  }
}

/**
 * Every live signal, for the banner. It follows `hasNextPage` up to the bound;
 * past it the read is `complete: false` and the banner says "at least N",
 * never "none" or an exact count from a partial read.
 */
export async function loadLiveStops(client: GraphQLClient, appRef: string): Promise<StopRead<LiveStops>> {
  const signals: StopSignal[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < STOP_BANNER_MAX_PAGES; page++) {
      const r: { teamStopSignals: StopSignalPage } = await client.request(TEAM_STOP_SIGNALS_QUERY, {
        appRef,
        includeEnded: false,
        first: STOP_BANNER_PAGE,
        ...(after ? { after } : {}),
      });
      signals.push(...r.teamStopSignals.signals);
      const info = r.teamStopSignals.pageInfo;
      if (!info.hasNextPage || !info.endCursor) return { kind: 'ok', value: { signals, complete: true } };
      after = info.endCursor;
    }
    return { kind: 'ok', value: { signals, complete: false } };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'APP_NOT_FOUND') return { kind: 'not-participant' };
    console.warn(`[stop-signals] live read for ${appRef} failed:`, e);
    return { kind: 'failed' };
  }
}

/** `App.viewerManages`: a failed or odd answer is `unknown`, never `no`. */
export async function loadManagesHint(client: GraphQLClient, appRef: string): Promise<ManagesHint> {
  try {
    const r = await client.request<{ app: { viewerManages?: unknown } | null }>(APP_VIEWER_MANAGES_QUERY, { ref: appRef });
    const v = r.app?.viewerManages;
    return v === true ? 'yes' : v === false ? 'no' : 'unknown';
  } catch (e) {
    console.warn(`[stop-signals] manager hint for ${appRef} failed:`, e);
    return 'unknown';
  }
}

/** The roster's workers: the picker's options and the id-to-name lookup. A failed read costs only names. */
export async function loadStopWorkers(client: GraphQLClient, appRef: string): Promise<WorkerOption[]> {
  try {
    const r = await client.request<{ teamRoster: { workers: { worker: WorkerOption }[] } }>(STOP_WORKERS_QUERY, { appRef });
    return r.teamRoster.workers.map((w) => w.worker);
  } catch (e) {
    console.warn(`[stop-signals] roster read for ${appRef} failed:`, e);
    return [];
  }
}

/** Members the viewer may see, by user id. `members: null` is withheld, so it names no one. */
export async function loadStopPeople(client: GraphQLClient, appRef: string): Promise<Record<string, string>> {
  try {
    const r = await client.request<{ app: { members: { user: { id: string; handle: string | null; name: string | null } | null }[] | null } | null }>(
      STOP_PEOPLE_QUERY,
      { ref: appRef },
    );
    const out: Record<string, string> = {};
    for (const m of r.app?.members ?? []) if (m.user) out[m.user.id] = m.user.name ?? m.user.handle ?? m.user.id;
    return out;
  } catch (e) {
    console.warn(`[stop-signals] member read for ${appRef} failed:`, e);
    return {};
  }
}

// ── the set form ─────────────────────────────────────────────────────────

const LEVELS: StopLevel[] = ['PAUSE_DISPATCH', 'PAUSE', 'HALT'];
const SCOPES: StopScope[] = ['WORKER', 'TEAM']; // HOST is display-only: never sent by the portal.

export interface SetStopInput {
  appRef: string;
  level: StopLevel;
  scope: StopScope;
  worker: string;
  until?: string;
}

/**
 * The input a set sends. WORKER and TEAM both name a worker (a team by its
 * head); HOST is never built here. `until` must be later than `now`, checked
 * here and again by the server.
 */
export function buildSetInput(
  fd: FormData,
  appRef: string,
  now: Date = new Date(),
): { input: SetStopInput } | { invalid: { field: string; message: string } } {
  const level = String(fd.get('level') ?? '') as StopLevel;
  if (!LEVELS.includes(level)) return { invalid: { field: 'level', message: t('app.stops.invalid.level', 'Choose a level.') } };
  const scope = String(fd.get('scope') ?? '') as StopScope;
  if (!SCOPES.includes(scope)) return { invalid: { field: 'scope', message: t('app.stops.invalid.scope', 'Choose a worker or a team.') } };
  const worker = String(fd.get('worker') ?? '').trim();
  if (!worker) {
    return {
      invalid: {
        field: 'worker',
        message:
          scope === 'TEAM'
            ? t('app.stops.invalid.head', 'Choose the worker who heads the team.')
            : t('app.stops.invalid.worker', 'Choose a worker.'),
      },
    };
  }
  const input: SetStopInput = { appRef, level, scope, worker };
  const rawUntil = String(fd.get('until') ?? '').trim();
  if (rawUntil) {
    const ms = Date.parse(rawUntil);
    if (Number.isNaN(ms) || ms <= now.getTime()) {
      return { invalid: { field: 'until', message: t('app.stops.invalid.until', 'Choose a time later than now, or leave it empty to stop until lifted.') } };
    }
    input.until = new Date(ms).toISOString();
  }
  return { input };
}

/**
 * Codes the portal answers with its own fixed sentence (never the server's
 * text). Everything else, and every transport failure, gets the uncertain
 * line. STOP_SIGNAL_UNAVAILABLE is a typed refusal: NOTHING WAS SET.
 */
const STOP_SENTENCES: Record<string, () => string> = {
  APP_MANAGER_REQUIRED: () => t('app.stops.refusal.manager', 'Only whoever manages this App can set or lift a stop.'),
  HOST_SCOPE_REQUIRED: () => t('app.stops.refusal.host', 'A stop on a host can only be set with that host’s own key.'),
  STOP_SIGNAL_SCOPE_FORBIDDEN: () => t('app.stops.refusal.scope', 'You can’t stop that worker or team from this App.'),
  STOP_SIGNAL_NOT_FOUND: () => t('app.stops.refusal.not-found', 'That stop no longer exists. Reload to see the current stops.'),
  STOP_SIGNAL_UNAVAILABLE: () =>
    t('app.stops.refusal.unavailable', 'Nothing was set. A worker this stop would cover has no consumer that can receive stop notices yet.'),
  BAD_USER_INPUT: () => t('app.stops.refusal.input', 'The server didn’t accept that stop. Check the worker and the time.'),
  APP_NOT_FOUND: () => t('app.stops.refusal.app', 'This App couldn’t be found.'),
};

export function classifyStopError(e: unknown): WriteRefusal {
  if (!e || typeof e !== 'object' || !('response' in e)) return { kind: 'uncertain' };
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } }).response?.errors?.[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null;
  if (!code) return { kind: 'uncertain' };
  const sentence = STOP_SENTENCES[code];
  if (sentence) return { kind: 'refused', code, message: sentence() };
  if (code === 'FORBIDDEN' && first?.message === IMPERSONATION_SENTENCE) return { kind: 'refused', code, message: IMPERSONATION_SENTENCE };
  return { kind: 'uncertain' };
}
