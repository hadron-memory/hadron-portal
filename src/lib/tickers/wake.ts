/**
 * portal#1099 — "why is (or isn't) this worker woken?", in one sentence
 * (design §4.1). Derived EXHAUSTIVELY from the server's wake settings, first
 * matching row wins:
 *
 *   retired → dormant → paused → (mentions × tickers)
 *
 * The first three are the never-due cases of
 * hrn:node:hadronmemory.com:specs:cor:agt:080:11 (dormant per :07), so they
 * come before anything a mention or a tick could do. Being unavailable for
 * work, or held by nobody, does NOT stop wakes (:11), so neither appears here.
 *
 * Anything this table doesn't cover (an unknown mentions mode, an unreadable
 * pause, an effective cadence with no enabled subscription behind it) is
 * `unknown`: the view says "Wake state unknown" and lists the raw fields. It
 * never borrows another row's sentence.
 *
 * "Woken" here means DUE: tickers decide when, a router delivers (hrn:node:hadronmemory.com:specs:cor:agt:080:09),
 * and the view says so under the sentence.
 */
import { t } from '$lib/i18n/t';
import { cadenceText } from './format';
import { fmtRunTime } from '$lib/flow/runs';
import type { WorkerWakeSettings } from './types';

export type WakeStatusKind =
  | 'retired'
  | 'dormant'
  | 'paused'
  | 'nothing'
  | 'tickers-only'
  | 'mentions-only'
  | 'mentions-and-tickers'
  | 'unknown';

export interface WakeStatus {
  kind: WakeStatusKind;
  /** The sentence's bold lead, when it has one ("Not woken: dormant."). */
  lead: string | null;
  text: string;
}

export function wakeStatus(
  settings: WorkerWakeSettings,
  worker: { retiredAt: string | null },
  now: number,
): WakeStatus {
  if (worker.retiredAt) {
    return { kind: 'retired', lead: null, text: t('worker.wake.status.retired', 'Retired: never woken.') };
  }
  if (settings.dormant) {
    return {
      kind: 'dormant',
      lead: t('worker.wake.status.dormant.lead', 'Not woken: dormant.'),
      text: t(
        'worker.wake.status.dormant',
        'None of its sessions has been active within the App’s dormancy period. Mentions to it are counted, not dropped, and it will be woken again once a session is active.',
      ),
    };
  }
  if (settings.pausedUntil != null) {
    const until = Date.parse(settings.pausedUntil);
    if (Number.isNaN(until)) return unknown();
    if (until > now) {
      return {
        kind: 'paused',
        // Uma's P3-2 on #1136: fmtRunTime, like every other time on the tab.
        lead: t('worker.wake.status.paused.lead', 'Paused until {time}.', { time: fmtRunTime(settings.pausedUntil) }),
        text: t('worker.wake.status.paused', 'Nothing wakes it until then, not even mentions.'),
      };
    }
  }

  const mentionsOn = settings.mentions === 'IMMEDIATE';
  if (!mentionsOn && settings.mentions !== 'OFF') return unknown();

  // The server's effective cadence is the fastest live subscription on an
  // ENABLED ticker. It and the subscription list must agree; when they don't,
  // the sentence would be a guess.
  const enabledSubs = settings.subscriptions.filter((s) => s.ticker.enabled);
  const cadence = settings.effectiveCadenceSeconds;
  const ticking = cadence != null;
  if (ticking !== enabledSubs.length > 0) return unknown();
  const every = cadenceText(cadence);

  if (!mentionsOn && !ticking) {
    return {
      kind: 'nothing',
      lead: t('worker.wake.status.nothing.lead', 'Nothing wakes it.'),
      text: t('worker.wake.status.nothing', 'Mentions are off and it follows no ticker.'),
    };
  }
  if (!mentionsOn) {
    return {
      kind: 'tickers-only',
      lead: null,
      text: t('worker.wake.status.tickers-only', 'Woken by its tickers, at most every {every}, when it has unread messages. Mentions don’t wake it.', { every }),
    };
  }
  if (!ticking) {
    return {
      kind: 'mentions-only',
      lead: null,
      text: t('worker.wake.status.mentions-only', 'Woken at once when mentioned. No ticker wakes it for other unread messages.'),
    };
  }
  return {
    kind: 'mentions-and-tickers',
    lead: null,
    text: t(
      'worker.wake.status.both',
      'Woken at once when mentioned, and by its tickers at most every {every} when it has unread messages.',
      { every },
    ),
  };
}

function unknown(): WakeStatus {
  return { kind: 'unknown', lead: t('worker.wake.status.unknown.lead', 'Wake state unknown.'), text: '' };
}
