/**
 * portal#1151 (Tickers S7b) — the markup of the New ticker and Edit ticker
 * sections, rendered on the server: who is offered them, what they can send,
 * and what they never offer (activation, channels, quiet hours, relevance).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
// portal#1497: the on/off control on the detail page reads the page store.
vi.mock('$app/stores', () => ({ page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/') }), () => {}) } }));
import List from './+page.svelte';
import Detail from './[tickerId]/+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 480, dailyWakeBudgetDerived: true } };
const delivery = { kind: 'ok', value: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false } };
const ticker = (over: Record<string, unknown> = {}) => ({
  id: 'tk-1', name: 'engineering', slug: 'engineering', tickCode: 'tick.engineering', urn: 'hrn:ticker:acme.com:team:engineering',
  enabled: true, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z', nextTickAt: null, lastTickAt: null, quietHours: null,
  relevance: 'ALL', reasons: ['READ_TEAM_CHANNEL'], channels: [], owner: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: null,
  subscribers: { hasNextPage: false, items: [] },
  ...over,
});

const list = (over: Record<string, unknown> = {}) =>
  render(List as never, {
    props: { data: { app, tickers: { kind: 'ok', value: [] }, settings, delivery, subscriberCountPage: 50, loadedAt: '2026-10-16T10:00:00Z', impersonating: null, ...over } },
  } as never).body;
const detail = (over: Record<string, unknown> = {}) =>
  render(Detail as never, {
    props: {
      data: {
        app, ticker: ticker(), settings, paged: false, loadedAt: '2026-10-16T10:00:00Z', impersonating: null,
        tickerTask: { kind: 'ok', value: null },
        // portal#1497: the detail page's controls read these; roster ok keeps
        // the Add-subscriber chooser out of these S7b assertions' way.
        roster: { kind: 'ok', workers: [] },
        user: null,
        subscribers: { kind: 'ok', value: { items: [], hasNextPage: false, endCursor: null } },
        ...over,
      },
    },
  } as never).body;
const section = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-testid="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';

describe('New ticker (list page)', () => {
  // portal#1463: the section and the form it holds each carry their OWN test id, so a
  // selector names one of them and never both (the create form was `ticker-create` too).
  it('the section and its form carry different test ids, each exactly once', () => {
    const html = list();
    const count = (id: string) => (html.match(new RegExp(`data-testid="${id}"`, 'g')) ?? []).length;
    expect(count('ticker-create-section')).toBe(1);
    expect(count('ticker-create')).toBe(1);
    expect(section(html, 'ticker-create-section')).toContain('data-testid="ticker-create"');
  });

  it('is offered to every participant, with Team chat preselected and every reason listed with its help', () => {
    const html = section(list(), 'ticker-create-section');
    expect(html).toContain('New ticker');
    expect(html).toContain('action="?/create"');
    expect(html).toMatch(/value="READ_TEAM_CHANNEL"[^>]*checked/);
    expect(html).not.toMatch(/value="EVERY_TICK"[^>]*checked/);
    for (const label of ['Team chat', 'Every tick', 'Live check']) expect(html).toContain(label);
    expect(html).toContain('Any one of these wakes a subscriber.');
    expect(html).toContain('costs up to one wake per subscriber per tick');
  });

  it('is shown on an empty list too, and the old "not available" line is gone', () => {
    const html = list();
    expect(html).toContain('No tickers yet.');
    expect(html).toContain('data-testid="ticker-create-section"');
    expect(html).not.toContain('isn’t available in the portal');
  });

  it('offers no activation, channel, quiet-hours or relevance field', () => {
    const html = section(list(), 'ticker-create-section');
    expect(html).not.toMatch(/name="(enabled|channelIds|quietHours|relevance)"/);
    expect(html).toContain('>Create<');
  });

  it('a support session sees the reason it can’t change anything, and no form', () => {
    const html = section(list({ impersonating: 'Rae' }), 'ticker-create-section');
    expect(html).not.toMatch(/<form/);
    expect(html).toContain('changes are switched off in a support session');
  });

  it('a list that could not be read offers no create form', () => {
    expect(list({ tickers: { kind: 'failed' } })).not.toContain('data-testid="ticker-create-section"');
    expect(list({ tickers: { kind: 'not-participant' } })).not.toContain('data-testid="ticker-create-section"');
  });
});

describe('Edit ticker (ticker page)', () => {
  it('the section and its form carry different test ids', () => {
    const html = detail();
    expect(section(html, 'ticker-edit-section')).toContain('data-testid="ticker-edit-tk-1"');
    expect(html).not.toContain('data-testid="ticker-edit"');
  });

  it('shows the stored values with the Was fields an update diffs against', () => {
    const html = section(detail(), 'ticker-edit-section');
    expect(html).toContain('action="?/update"');
    expect(html).toMatch(/name="nameWas" value="engineering"/);
    expect(html).toMatch(/name="cadenceSecondsWas" value="600"/);
    expect(html).toMatch(/name="reasonsWas" value="READ_TEAM_CHANNEL"/);
    expect(html).toMatch(/name="reasonsShown" value="1"/);
    expect(html).toMatch(/value="READ_TEAM_CHANNEL"[^>]*checked/);
    expect(html).toContain('>Save<');
  });

  it('a ticker with a reason this build can’t show leaves reasons alone: no checkboxes, no reasonsShown', () => {
    const html = section(detail({ ticker: ticker({ reasons: ['READ_TEAM_CHANNEL', 'FUTURE_REASON'] }) }), 'ticker-edit-section');
    expect(html).not.toContain('name="reasonsShown"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('its reasons are left as they are');
  });

  it('offers a confirmed Delete… and no enable, disable or subscribe control', () => {
    const html = section(detail(), 'ticker-edit-section');
    expect(html).toContain('Delete…');
    expect(html).not.toMatch(/>\s*(Enable|Disable|Subscribe|Add subscriber)\b/);
    expect(html).not.toContain('name="enabled"');
  });

  it('a support session gets neither the form nor Delete', () => {
    const html = section(detail({ impersonating: 'Rae' }), 'ticker-edit-section');
    expect(html).not.toMatch(/<form/);
    expect(html).not.toContain('Delete…');
  });
});
