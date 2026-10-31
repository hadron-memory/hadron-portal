/**
 * portal#1099 — the Tickers list, a ticker page and the Wake-ups panel,
 * rendered on the server. S7a is read-only (Holger via Vera, team chat
 * #11540): no view renders a write control, except the Delivery section's own
 * form for a manager (portal#1141 slice A).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
import List from './+page.svelte';
import Detail from './[tickerId]/+page.svelte';
import WakeUpsPanel from '$lib/components/tickers/WakeUpsPanel.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 480, dailyWakeBudgetDerived: true } };
const delivery = { kind: 'ok', value: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false } };
const LOADED = '2026-10-16T10:00:00Z';

const ticker = (over: Record<string, unknown> = {}) => ({
  id: 'tk-1', name: 'engineering', slug: 'engineering', tickCode: 'tick.engineering', urn: 'hrn:ticker:acme.com:team:engineering',
  enabled: true, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z',
  nextTickAt: '2026-10-16T10:10:00Z', lastTickAt: '2026-10-16T10:00:00Z',
  quietHours: { timezone: 'Europe/Berlin', windows: [{ days: [1, 2, 3, 4, 5], from: '22:00', to: '07:00' }] },
  relevance: 'ALL', channels: [], owner: { id: 'w-dara', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' },
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null,
  subscribers: { hasNextPage: false, items: [{ id: 's1' }, { id: 's2' }] },
  ...over,
});

// portal#1151 (S7b): the New ticker and Edit ticker sections are the ticker writes, pinned in
// write-forms.test.ts. These tests are about the READ views, so those sections are cut out here.
const WRITE_SECTION = /<section[^>]*data-testid="ticker-(create|edit)"[\s\S]*?<\/section>/;
const readView = (html: string) => html.replace(WRITE_SECTION, '');

function listFull(over: Record<string, unknown> = {}) {
  return render(List as never, {
    props: { data: { app, tickers: { kind: 'ok', value: [] }, settings, delivery, subscriberCountPage: 50, loadedAt: LOADED, impersonating: null, ...over } },
  } as never).body;
}
const list = (over: Record<string, unknown> = {}) => readView(listFull(over));

/**
 * No write control: no form, no named form field (the grid's own search box
 * is chrome, not a field), and no button or link naming an S7b write.
 */
function expectReadOnly(rendered: string) {
  // portal#1141 A: the list now carries the Delivery section, whose form is its own write
  // (pinned in its tests below). This helper is about the TICKER views, so that section is cut out.
  const html = rendered.replace(/<section[^>]*data-testid="delivery-settings"[\s\S]*?<\/section>/, '');
  expect(html).not.toMatch(/<form/);
  expect(html).not.toMatch(/<(input|select|textarea)[^>]*\bname=/);
  expect(html).not.toMatch(/<(button|a)\b[^>]*>\s*(Create ticker|Edit|Disable|Enable|Delete|Add subscriber|Remove|Subscribe|Pause|Resume|Give scope|Take scope back|Save)\b/i);
}

describe('Tickers list', () => {
  it('the empty state never claims a ticker wakes anyone today, and separates due from delivery', () => {
    const html = list();
    expect(html).toContain('No tickers yet.');
    expect(html).toContain('A mention already makes a worker due at once, unless its mentions are off or it is paused.');
    expect(html).toContain('A router delivers the wake-ups. This page only decides who is due and when.');
    expect(html).not.toContain('hadron_ticker_create');
    expect(html).not.toMatch(/tickers (already )?wake/i);
    expectReadOnly(html);
  });

  it('counts against the live cap from the settings', () => {
    expect(list({ tickers: { kind: 'ok', value: [ticker()] } })).toContain('1 of 20 tickers');
  });

  it('renders a ticker row: linked name, URN, state, cadence, quiet hours, a counted page of subscribers', () => {
    const html = list({ tickers: { kind: 'ok', value: [ticker()] } });
    expect(html).toContain('href="/app/apps/app-1/tickers/tk-1"');
    expect(html).toContain('hrn:ticker:acme.com:team:engineering');
    expect(html).toContain('Ticking');
    expect(html).toContain('10 min');
    expect(html).toContain('22:00–07:00 Mon–Fri');
    // Anne's P2 on #1136: an empty channel list is also what the server sends
    // when every named channel is hidden from this reader, so it never claims
    // the ticker is unrestricted.
    expect(html).not.toContain('Every channel the subscriber watches');
    expect(html).toContain('Every watched channel, or channels hidden from you');
    expectReadOnly(html);
  });

  it('a full subscriber page reads 50+, never a guessed total', () => {
    const html = list({ tickers: { kind: 'ok', value: [ticker({ subscribers: { hasNextPage: true, items: [] } })] } });
    expect(html).toContain('50+');
  });

  it('a non-participant sees the inline state, not the grid or the settings', () => {
    const html = list({ tickers: { kind: 'not-participant' }, settings: { kind: 'not-participant' } });
    expect(html).toContain('data-testid="tickers-not-participant"');
    expect(html).not.toContain('data-testid="ticker-settings"');
    expect(html).not.toContain('No tickers yet.');
  });

  it('a failed read is an alert with a retry, never an empty list', () => {
    const html = list({ tickers: { kind: 'failed' } });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Couldn’t load tickers.');
    expect(html).not.toContain('No tickers yet.');
  });

  // portal#1141 A: the Delivery section is the one write on this page, offered to every participant
  // (the server's refusal answers anyone who may not; no client rights check).
  it('offers exactly one form, the Delivery one; the ticker settings stay read-only', () => {
    const html = list();
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain('action="?/delivery"');
    expect(html).toContain('Save delivery settings');
    expect(html).toContain('Only whoever manages the App can change these settings.');
    expect(html).toContain('data-testid="ticker-settings"');
    expect(html).not.toContain('name="standbyEnabled"');
  });

  it('a support session gets the Delivery values without a form', () => {
    const html = list({ impersonating: 'Rae' });
    expect(html).not.toMatch(/<form/);
    expect(html).toContain('Busy delay (seconds)');
  });

  it('shows the App’s settings read-only, saying who can change them', () => {
    const html = list();
    expect(html).toContain('Fastest ticker: every 2 min');
    expect(html).toContain('Up to 20 tickers');
    expect(html).toContain('480 wake-ups a day');
    expect(html).toContain('(set automatically from the team’s size)');
    expect(html).toContain('Only whoever manages the App can change these settings.');
  });
});

function detailFull(over: Record<string, unknown> = {}) {
  return render(Detail as never, {
    props: {
      data: {
        app, ticker: ticker(), settings, paged: false, loadedAt: LOADED, impersonating: null,
        tickerTask: { kind: 'ok', value: { registerTaskLoc: 'tasks:on-base-tick' } },
        subscribers: { kind: 'ok', value: { items: [], hasNextPage: false, endCursor: null } },
        ...over,
      },
    },
  } as never).body;
}
const detail = (over: Record<string, unknown> = {}) => readView(detailFull(over));

describe('Ticker page', () => {
  it('shows the facts, read-only', () => {
    const html = detail();
    expect(html).toContain('data-testid="ticker-facts"');
    expect(html).toContain('22:00–07:00 Mon–Fri (overnight, ends next day)');
    expect(html).toContain('Time zone: Europe/Berlin.');
    expect(html).toContain('All unread: makes a subscriber due when it has unread messages in these channels.');
    expect(html).toContain('Only its owner, the owning worker’s holder, or whoever manages the App can change this ticker.');
    expectReadOnly(html);
  });

  // Anne's P2 on #1136: unrestricted and filtered-to-empty arrive as the same
  // [] and must read the same, neutral text, never 'every channel'.
  it('an empty channel list is described neutrally, not as every channel', () => {
    const html = detail();
    expect(html).not.toContain('Unread in every channel');
    expect(html).toContain('No channel you can read is named.');
    expect(html).toContain('either every channel each subscriber watches, or only channels hidden from you');
  });

  it('a named channel the reader can read is listed by name', () => {
    expect(detail({ ticker: ticker({ channels: [{ id: 'c1', name: 'team-chat' }] }) })).toContain('Unread in team-chat');
  });

  // Uma's P3-1 on #1136: say where changes are made, not only who may make them.
  // portal#1496 (MCP cut P1): that is the hadron CLI now, as commands to copy.
  it('gives the CLI commands to turn it on or off and to subscribe workers, naming no MCP tool', () => {
    const html = detail();
    expect(html).not.toContain('hadron_');
    expect(html).toContain('hadron ticker update hrn:ticker:acme.com:team:engineering --enabled=false');
    expect(html).toContain('hadron ticker update hrn:ticker:acme.com:team:engineering --enabled<');
    expect(html).toContain('hadron ticker subscribe hrn:ticker:acme.com:team:engineering --worker &lt;worker-id-or-URN>');
    expect(html).toContain('hadron ticker unsubscribe hrn:ticker:acme.com:team:engineering --worker &lt;worker-id-or-URN>');
  });

  // cor:agt:080:18 stays above the on/off command; cor:agt:080:20 sits directly
  // before the subscribe commands.
  it('says who may change it before the on/off command, and who may subscribe before subscribing', () => {
    const html = detail();
    const who = html.indexOf('Only its owner, the owning worker’s holder, or whoever manages the App can change this ticker.');
    const off = html.indexOf('--enabled=false');
    const subWho = html.indexOf('Only a worker’s holder or whoever manages the App can subscribe or unsubscribe that worker.');
    const sub = html.indexOf('hadron ticker subscribe');
    expect(who).toBeGreaterThan(-1);
    expect(who).toBeLessThan(off);
    expect(off).toBeLessThan(subWho);
    expect(subWho).toBeLessThan(sub);
    expect(html.slice(subWho, sub)).not.toMatch(/<code/);
  });

  it('falls back to the ticker id when it has no URN', () => {
    const html = detail({ ticker: ticker({ urn: null }) });
    expect(html).toContain('hadron ticker update tk-1 --enabled=false');
    expect(html).toContain('hadron ticker subscribe tk-1 --worker');
  });

  it('quotes a ref the shell would split', () => {
    const html = detail({ ticker: ticker({ urn: null, id: "tk 1'x" }) });
    expect(html).toContain("hadron ticker update 'tk 1'\\''x' --enabled=false");
  });

  it('renders no command with an empty operand when there is neither URN nor id', () => {
    const html = detail({ ticker: ticker({ urn: null, id: '' }) });
    expect(html).not.toContain('hadron ticker update');
    expect(html).not.toContain('hadron ticker subscribe');
  });

  it('no subscribers reads “Nobody follows this ticker yet.”', () => {
    expect(detail()).toContain('Nobody follows this ticker yet.');
  });

  it('subscribers show the creator only, a grant chip, and a forward page link when there are more', () => {
    const html = detail({
      subscribers: {
        kind: 'ok',
        value: {
          items: [{ id: 's1', createdAt: '2026-10-10T00:00:00Z', viaGrant: true, createdBy: { id: 'w-ada', name: 'Ada', urn: null }, worker: { id: 'w-liam', name: 'Liam', urn: 'hrn:worker:acme.com:team:liam', retiredAt: null } }],
          hasNextPage: true,
          endCursor: 's1',
        },
      },
    });
    expect(html).toContain('Liam');
    expect(html).toContain('href="/app/workers/w-liam?tab=wake"');
    expect(html).toContain('Ada');
    expect(html).toContain('via grant');
    expect(html).toContain('href="/app/apps/app-1/tickers/tk-1?after=s1"');
    expectReadOnly(html);
  });

  it('a disabled ticker says it wakes no one', () => {
    expect(detail({ ticker: ticker({ enabled: false, nextTickAt: null }) })).toContain('A disabled ticker keeps its subscribers but wakes no one.');
  });

  it('a failed subscriber read is an alert, not “Nobody follows”', () => {
    const html = detail({ subscribers: { kind: 'failed' } });
    expect(html).toContain('Couldn’t load this ticker’s subscribers.');
    expect(html).not.toContain('Nobody follows this ticker yet.');
  });
});

const wake = (over: Record<string, unknown> = {}) => ({
  kind: 'ok',
  value: { mentions: 'IMMEDIATE', pausedUntil: null, dormant: false, effectiveCadenceSeconds: null, subscriptions: [], ...over },
});
function panel(props: Record<string, unknown> = {}) {
  return render(WakeUpsPanel as never, {
    props: { wake: wake(), appSettings: settings, worker: { retiredAt: null }, appId: 'app-1', loadedAt: LOADED, ...props },
  } as never).body;
}

describe('Wake-ups panel', () => {
  it('leads with the sentence, then the floor and the router line', () => {
    const html = panel();
    expect(html.indexOf('data-testid="wake-status"')).toBeLessThan(html.indexOf('data-testid="wake-settings"'));
    expect(html).toContain('Woken at once when mentioned. No ticker wakes it for other unread messages.');
    expect(html).toContain('No worker is woken more often than every 2 min in this App.');
    expect(html).toContain('This page shows when the worker is due, not whether a wake-up was delivered.');
    expect(html).toContain('Not subscribed to any ticker.');
    expectReadOnly(html);
  });

  // Xavier's stamp: the dormant case, pinned in the rendered tab too.
  it('a dormant worker reads “Not woken: dormant.”', () => {
    const html = panel({ wake: wake({ dormant: true }) });
    expect(html).toContain('data-kind="dormant"');
    expect(html).toContain('Not woken: dormant.');
  });

  it('an uncovered combination says “Wake state unknown.” and lists the raw fields', () => {
    const html = panel({ wake: wake({ effectiveCadenceSeconds: 600 }) });
    expect(html).toContain('Wake state unknown.');
    expect(html).toContain('data-testid="wake-raw"');
    expect(html).toContain('effectiveCadenceSeconds');
  });

  // portal#1496 (MCP cut P1): the CLI commands, each with a setting operand.
  it('gives the CLI commands to change wake settings, naming no MCP tool', () => {
    const html = panel({ worker: { retiredAt: null, id: 'w-liam', urn: 'hrn:worker:acme.com:team:liam' } });
    expect(html).not.toContain('hadron_');
    for (const setting of ['--mentions off', '--mentions immediate', '--clear-pause', '--paused-until &lt;RFC3339>']) {
      expect(html).toContain(`hadron team wake-settings set --worker hrn:worker:acme.com:team:liam ${setting}`);
    }
  });

  // cor:agt:080:21: mentions and pause only; subscriptions follow cor:agt:080:20.
  it('says who may change mentions and pause, not subscriptions', () => {
    const html = panel({ worker: { retiredAt: null, id: 'w-liam', urn: 'hrn:worker:acme.com:team:liam' } });
    expect(html).toContain('Only the worker itself, its holder, or whoever manages the App can change its mentions or pause.');
    expect(html).not.toContain('mentions, pause or subscriptions');
  });

  it('falls back to the worker id when it has no URN, and quotes what the shell would split', () => {
    expect(panel({ worker: { retiredAt: null, id: 'w-liam', urn: null } })).toContain('hadron team wake-settings set --worker w-liam --mentions off');
    expect(panel({ worker: { retiredAt: null, id: "w liam's", urn: null } })).toContain("hadron team wake-settings set --worker 'w liam'\\''s' --mentions off");
  });

  it('renders no command with an empty operand when the worker has neither URN nor id', () => {
    expect(panel()).not.toContain('hadron team wake-settings');
  });

  it('a non-participant sees the inline state, not the worker’s settings', () => {
    const html = panel({ wake: { kind: 'not-participant' } });
    expect(html).toContain('You don’t take part in this worker’s App, so its wake-ups aren’t shown.');
    expect(html).not.toContain('data-testid="wake-settings"');
  });

  it('a failed read is an alert', () => {
    expect(panel({ wake: { kind: 'failed' } })).toContain('Couldn’t load this worker’s wake-ups.');
  });

  it('lists subscriptions with their tickers linked', () => {
    const html = panel({
      wake: wake({
        effectiveCadenceSeconds: 600,
        subscriptions: [{ id: 's1', createdAt: '2026-10-10T00:00:00Z', viaGrant: false, createdBy: null, ticker: { id: 'tk-1', name: 'engineering', urn: null, enabled: true, cadenceSeconds: 600, quietHours: null } }],
      }),
    });
    expect(html).toContain('href="/app/apps/app-1/tickers/tk-1"');
    expect(html).toContain('Woken at once when mentioned, and by its tickers at most every 10 min');
    expectReadOnly(html);
  });
});

// Pin both directions: the guard above must fail on the controls it exists to catch.
describe('expectReadOnly (positive control)', () => {
  it.each([
    '<form method="POST"><button>Go</button></form>',
    '<input type="number" name="cadenceSeconds">',
    '<button type="button">Delete ticker</button>',
    '<a href="/x">Add subscriber</a>',
    '<button class="x">Pause for…</button>',
  ])('rejects %s', (html) => {
    expect(() => expectReadOnly(html)).toThrow();
  });
});

describe('ticker reasons (portal#1144)', () => {
  const reasoned = (reasons: unknown) => ticker({ reasons });
  it('the list shows a Reasons column with a badge per reason, Every tick explicit', () => {
    const html = list({ tickers: { kind: 'ok', value: [reasoned(['READ_TEAM_CHANNEL']), reasoned(['EVERY_TICK', 'READ_TEAM_CHANNEL'])].map((tk, i) => ({ ...tk, id: `tk-${i}` })) } });
    expect(html).toContain('Wakes when');
    expect(html).toContain('Team chat');
    expect(html).toContain('Every tick');
    expectReadOnly(html);
  });
  it('an unknown reason shows its raw name, and is not turned into a known one', () => {
    const html = list({ tickers: { kind: 'ok', value: [reasoned(['SOMETHING_NEW'])] } });
    expect(html).toContain('SOMETHING_NEW');
    expect(html).toContain('(unrecognised)');
    expect(html).not.toContain('Team chat');
  });
  it('an empty reason list reads as never firing in the list', () => {
    expect(list({ tickers: { kind: 'ok', value: [reasoned([])] } })).toContain('Never fires (no reasons)');
  });
  it('the detail page lists "Wakes when" with the every-tick limits in the same item', () => {
    const html = detail({ ticker: reasoned(['EVERY_TICK']) });
    expect(html).toContain('Wakes when');
    const item = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*Every tick(?:(?!<\/li>)[\s\S])*<\/li>/)?.[0] ?? '';
    expect(item).toContain('even with no new chat');
    expect(item).toContain('quiet hours');
    expect(item).toContain('pause');
    expectReadOnly(html);
  });
  it('markup in a reason value is escaped in the list and the detail, never rendered', () => {
    const list_ = list({ tickers: { kind: 'ok', value: [reasoned(['<b>X</b>'])] } });
    const detail_ = detail({ ticker: reasoned(['<b>X</b>']) });
    for (const html of [list_, detail_]) {
      expect(html).toContain('&lt;b>X&lt;/b>');
      expect(html).not.toContain('<b>X</b>');
    }
  });
  it('a missing or non-array reasons reads as unavailable in both views, never as never firing', () => {
    for (const bad of [undefined, 'EVERY_TICK', null]) {
      const l = list({ tickers: { kind: 'ok', value: [reasoned(bad)] } });
      const d = detail({ ticker: reasoned(bad) });
      for (const html of [l, d]) {
        expect(html).toContain('Reasons unavailable');
        expect(html).not.toMatch(/never fires/i);
      }
    }
  });
  it('renders Live check, and the any-of note only when there are several reasons', () => {
    const one = detail({ ticker: reasoned(['LIVE_CHECK']) });
    expect(one).toContain('Live check');
    expect(one).toContain('has not checked its team channel');
    expect(one).not.toContain('Any one of these wakes a subscriber.');
    const two = detail({ ticker: reasoned(['LIVE_CHECK', 'EVERY_TICK']) });
    expect(two).toContain('Any one of these wakes a subscriber.');
  });
  it('the every-tick sentence names the cost clause next to the limits', () => {
    const html = detail({ ticker: reasoned(['EVERY_TICK']) });
    expect(html).toContain('costs up to one wake per subscriber per tick against the daily budget');
  });
  it('the list badges for Live check and Every tick carry a title with what they do; a known reason shows no unrecognised note', () => {
    const html = list({ tickers: { kind: 'ok', value: [reasoned(['LIVE_CHECK', 'EVERY_TICK'])] } });
    expect(html).toMatch(/title="Wakes a subscriber that has not checked[^"]*"[^>]*>Live check/);
    expect(html).toMatch(/title="Wakes subscribers every tick[^"]*"[^>]*>Every tick/);
    expect(html).not.toContain('(unrecognised)');
  });
  it('a list with a non-string element is unavailable in the list and the detail, never badges for its string members', () => {
    for (const bad of [[null], ['EVERY_TICK', 3]]) {
      const l = list({ tickers: { kind: 'ok', value: [reasoned(bad)] } });
      const d = detail({ ticker: reasoned(bad) });
      for (const html of [l, d]) {
        expect(html).toContain('Reasons unavailable');
        expect(html).not.toContain('Every tick');
        expect(html).not.toContain('(unrecognised)');
      }
    }
  });
  it('the detail page shows an unknown reason raw and an empty list as never firing', () => {
    const unknown = detail({ ticker: reasoned(['SOMETHING_NEW']) });
    expect(unknown).toContain('SOMETHING_NEW');
    expect(unknown).toContain('(unrecognised)');
    expect(detail({ ticker: reasoned([]) })).toContain('Never fires (no reasons)');
  });
});

// portal#1384 (T-P1): the Task entry. The portal shows what the server returns and nothing it
// would have to invent: no node fetch, no URN built from a loc, no mapping editor.
describe('Ticker page: the Task entry (portal#1384)', () => {
  const entry = (html: string) => html.match(/<div[^>]*data-testid="ticker-task"[\s\S]*?<\/dd>/)?.[0] ?? '';
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  const noLoc = { kind: 'ok', value: { registerTaskLoc: null } };

  it('mapped: the loc once in mono, the code once, and the line that each worker runs its own role’s task', () => {
    const e = entry(detail());
    expect(e).not.toBe('');
    expect(count(e, 'tasks:on-base-tick')).toBe(1);
    expect(count(e, 'tick.engineering')).toBe(1);
    expect(e).toMatch(/<(code|span)[^>]*font-mono[^>]*>[^<]*tasks:on-base-tick/);
    expect(e).toContain('Each worker runs the task at this location in its own role, or the shared one.');
    expect(e).not.toContain('No task you can see');
  });

  it('no loc: says so, gives the code and how to fix it, and shows no loc, URN chip or empty chip', () => {
    const e = entry(detail({ tickerTask: noLoc }));
    expect(e).toContain('No task you can see is mapped to this ticker.');
    expect(count(e, 'tick.engineering')).toBe(1);
    expect(e).toContain('map this code in the team Agent’s system memory');
    expect(e).not.toContain('tasks:on-base-tick');
    expect(e).not.toContain('Each worker runs');
    expect(e).not.toMatch(/data-testid="urn/);
    expect(e).not.toMatch(/<(code|span)[^>]*>\s*<\/(code|span)>/);
  });

  it('never invents a URN or a node link, in either state', () => {
    for (const tickerTask of [{ kind: 'ok', value: { registerTaskLoc: 'tasks:on-base-tick' } }, noLoc]) {
      const e = entry(detail({ tickerTask }));
      expect(e).not.toBe('');
      expect(e).not.toContain('hrn:node:');
      expect(e).not.toContain('/app/u/');
      expect(e).not.toMatch(/<a\b/);
    }
  });

  it('shows tickCode as the server gave it; two copies with different names and slugs share one code', () => {
    const a = entry(detail({ ticker: ticker({ name: 'Eng A', slug: 'eng-a', tickCode: 'tick.shared' }) }));
    const b = entry(detail({ ticker: ticker({ name: 'Eng B', slug: 'eng-b', tickCode: 'tick.shared' }) }));
    expect(count(a, 'tick.shared')).toBe(1);
    expect(count(b, 'tick.shared')).toBe(1);
    expect(a).not.toContain('tick.eng-a');
    expect(b).not.toContain('tick.eng-b');
  });

  it('a failed task read says it could not load, with a retry, and never reads as “no task mapped”', () => {
    const html = detail({ tickerTask: { kind: 'failed' } });
    const e = entry(html);
    expect(e).toContain('Couldn’t load this ticker’s task.');
    expect(e).toContain('Try again');
    expect(e).not.toContain('No task you can see');
    // the rest of the page is intact
    expect(html).toContain('data-testid="ticker-facts"');
    expect(html).toContain('Nobody follows this ticker yet.');
  });

  it('a read that says nothing about this ticker (not-participant, or the ticker gone) renders no Task entry and claims no mapping', () => {
    for (const tickerTask of [{ kind: 'not-participant' }, { kind: 'ok', value: null }]) {
      const html = detail({ tickerTask });
      expect(html).not.toContain('data-testid="ticker-task"');
      expect(html).not.toContain('No task you can see');
      expect(html).toContain('data-testid="ticker-facts"');
    }
  });

  it('an empty code (a stale snapshot) omits the code line and raises no error', () => {
    const e = entry(detail({ ticker: ticker({ tickCode: '' }) }));
    expect(e).toContain('tasks:on-base-tick');
    expect(e).not.toMatch(/Code/);
  });

  it('escapes markup in a loc and a code', () => {
    const e = entry(detail({ ticker: ticker({ tickCode: 'tick.<img src=x>' }), tickerTask: { kind: 'ok', value: { registerTaskLoc: 'a:<script>x</script>' } } }));
    expect(e).not.toContain('<script>');
    expect(e).not.toContain('<img');
    expect(e).toContain('&lt;script>');
  });

  it('stays read-only', () => {
    expectReadOnly(detail());
    expectReadOnly(detail({ tickerTask: noLoc }));
    expectReadOnly(detail({ tickerTask: { kind: 'failed' } }));
  });
});
