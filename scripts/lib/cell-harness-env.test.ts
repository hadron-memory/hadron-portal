import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain .mjs helper shared with the layout script
import { parseHarnessEnv, injectionEcho, KINDS, PAGE_KINDS, APPS_KINDS, ORGS_KINDS, TITLE_CHECKED_KINDS, batteryFor, partyNarrowProbeNote, PARTY_NARROW_PROBE_WIDTH, PARTY_NARROW_CLAIM } from './cell-harness-env.mjs';

// The accepted set, spelled out here on purpose — see the accept test below.
// The ten apps kinds join from main's portal#2488 slice, the nine orgs kinds from portal#2491 and wake
// from main's portal#2501 slice (unioned in #2507's carries).
const ALL_KINDS = ['alarms', 'runs', 'config', 'findings', 'wake', 'agent-tasks', 'party-label', 'agents-mine', 'memories-mine', 'memories-shared', 'agent-apps', 'agent-bundled', 'node-properties', 'node-history', 'apps-staff', 'apps-agents', 'apps-keys', 'apps-mine', 'apps-secrets', 'apps-stops', 'apps-tickers', 'apps-tasks', 'apps-channels', 'apps-grants', 'orgs-mine', 'orgs-apps', 'orgs-members', 'orgs-runs', 'orgs-agents', 'orgs-subscribed-agents', 'orgs-memories-personal', 'orgs-memories-org', 'orgs-memories-subscriptions', 'orgs-sessions', 'lib-rows'];

// portal#2129 rows 1, 6, 8: every env knob is validated before any browser launches.
describe('parseHarnessEnv', () => {
  it('accepts an empty environment', () => {
    expect(parseHarnessEnv({})).toEqual({ cellWidth: null, cellKind: null, injectPointerFailure: false, injectMissingTrigger: false });
  });
  it.each(['1', '390', '1280', '99999'])('accepts CELL_WIDTH=%s', v => {
    expect(parseHarnessEnv({ CELL_WIDTH: v }).cellWidth).toBe(Number(v));
  });
  it.each(['', ' ', '0', '-1', 'abc', '390px', 'Infinity', '1e3', '3.5', '100000', '0390'])('rejects CELL_WIDTH=%j', v => {
    expect(() => parseHarnessEnv({ CELL_WIDTH: v })).toThrow(`CELL_WIDTH must be a whole number of pixels from 1 to 99999, got ${JSON.stringify(v)}`);
  });
  // Literal list, not KINDS: the accept test must fail when a kind joins the
  // helper's list without anyone choosing to accept it (blind review, #2507) —
  // it.each(KINDS) could never go red, no matter what KINDS became.
  it('KINDS is exactly the kinds named below', () => {
    expect(KINDS).toEqual(ALL_KINDS);
  });
  it.each(ALL_KINDS)('accepts CELL_KIND=%s', v => {
    expect(parseHarnessEnv({ CELL_KIND: v }).cellKind).toBe(v);
  });
  it.each(['', 'Findings', 'tasks', 'edge-removals', 'staff'])('rejects CELL_KIND=%j', v => {
    expect(() => parseHarnessEnv({ CELL_KIND: v })).toThrow(`CELL_KIND must be one of ${ALL_KINDS.join(', ')}, got ${JSON.stringify(v)}`);
    expect(() => parseHarnessEnv({ CELL_KIND: v })).toThrow(`, got ${JSON.stringify(v)}`);
  });
  describe.each(['CELL_INJECT_POINTER_FAILURE', 'CELL_INJECT_MISSING_TRIGGER'])('%s', name => {
    const key = name === 'CELL_INJECT_POINTER_FAILURE' ? 'injectPointerFailure' : 'injectMissingTrigger';
    it('is off when unset or 0, on when 1', () => {
      expect(parseHarnessEnv({})[key]).toBe(false);
      expect(parseHarnessEnv({ [name]: '0' })[key]).toBe(false);
      expect(parseHarnessEnv({ [name]: '1' })[key]).toBe(true);
    });
    it.each(['', '2', 'true', ' 1'])('rejects %j', v => {
      expect(() => parseHarnessEnv({ [name]: v })).toThrow(`${name} must be 0 or 1 when set, got ${JSON.stringify(v)}`);
    });
  });
});

describe('injection knobs and CELL_KIND', () => {
  it.each(['CELL_INJECT_POINTER_FAILURE', 'CELL_INJECT_MISSING_TRIGGER'])('%s=1 is rejected for a kind that never reaches the findings leg', name => {
    for (const kind of ['alarms', 'runs', 'config', 'wake', 'agent-tasks', 'party-label', 'lib-rows', ...APPS_KINDS]) {
      expect(() => parseHarnessEnv({ [name]: '1', CELL_KIND: kind })).toThrow(`${name}=1 only acts on the findings leg, got CELL_KIND=${JSON.stringify(kind)}`);
    }
  });
  it.each(['CELL_INJECT_POINTER_FAILURE', 'CELL_INJECT_MISSING_TRIGGER'])('%s=1 is accepted with CELL_KIND=findings or no kind, and 0 with any kind', name => {
    expect(() => parseHarnessEnv({ [name]: '1', CELL_KIND: 'findings' })).not.toThrow();
    expect(() => parseHarnessEnv({ [name]: '1' })).not.toThrow();
    expect(() => parseHarnessEnv({ [name]: '0', CELL_KIND: 'alarms' })).not.toThrow();
  });
});

describe('injectionEcho', () => {
  it('prints one line per knob set to exactly 1, nothing otherwise', () => {
    expect(injectionEcho(parseHarnessEnv({}))).toEqual([]);
    expect(injectionEcho(parseHarnessEnv({ CELL_INJECT_POINTER_FAILURE: '0', CELL_INJECT_MISSING_TRIGGER: '0' }))).toEqual([]);
    expect(injectionEcho(parseHarnessEnv({ CELL_INJECT_POINTER_FAILURE: '1' }))).toEqual(['INJECTION ACTIVE: CELL_INJECT_POINTER_FAILURE=1 (this run is expected to fail)']);
    expect(injectionEcho(parseHarnessEnv({ CELL_INJECT_POINTER_FAILURE: '1', CELL_INJECT_MISSING_TRIGGER: '1' }))).toHaveLength(2);
  });
});

// The kind-to-battery routing (blind review, #2507): the pages list in the
// script once ran all six page kinds for any non-page CELL_KIND. The routing is
// batteryFor's now — this table is the pin that keeps it symmetric.
describe('batteryFor', () => {
  it('routes no kind to the pages battery but the page kinds — the #2507 P2, pinned', () => {
    for (const kind of ALL_KINDS.filter(k => !PAGE_KINDS.includes(k))) {
      expect(batteryFor(kind).pages, `CELL_KIND=${kind}`).toEqual([]);
    }
    for (const kind of PAGE_KINDS) {
      expect(batteryFor(kind).pages, `CELL_KIND=${kind}`).toEqual([kind]);
    }
  });
  it('routes every kind to exactly one battery, alone', () => {
    for (const kind of ALL_KINDS) {
      const owned = Object.entries(batteryFor(kind)).filter(([, kinds]) => kinds.length > 0);
      expect(owned, `CELL_KIND=${kind}`).toHaveLength(1);
      expect(owned[0][1], `CELL_KIND=${kind}`).toEqual([kind]);
    }
  });
  // portal#2506 review F1: the component arm once omitted the partyLabel key,
  // so CELL_KIND=alarms|runs|config reached the script's
  // `battery.partyLabel.length` guard as undefined and threw TypeError — after
  // its legs had run, masking their failures behind a crash. Every arm answers
  // every battery key, always.
  it('answers every battery key for every kind, null included', () => {
    const BATTERY_KEYS = ['component', 'findings', 'wake', 'agentTasks', 'partyLabel', 'pages', 'apps', 'lib'];
    for (const kind of [...ALL_KINDS, null]) {
      expect(Object.keys(batteryFor(kind)).sort(), `CELL_KIND=${kind}`).toEqual([...BATTERY_KEYS].sort());
    }
  });
  it('null runs every battery at its full list', () => {
    expect(batteryFor(null)).toEqual({
      component: ['alarms', 'runs', 'config'],
      findings: ['findings'],
      wake: ['wake'],
      agentTasks: ['agent-tasks'],
      partyLabel: ['party-label'],
      pages: PAGE_KINDS,
      // Spelled out, not rebuilt from the constants: a kind added to either list must be a deliberate edit here.
      apps: ['apps-staff', 'apps-agents', 'apps-keys', 'apps-mine', 'apps-secrets', 'apps-stops', 'apps-tickers', 'apps-tasks', 'apps-channels', 'apps-grants',
        'orgs-mine', 'orgs-apps', 'orgs-members', 'orgs-runs', 'orgs-agents', 'orgs-subscribed-agents', 'orgs-memories-personal', 'orgs-memories-org', 'orgs-memories-subscriptions', 'orgs-sessions'],
      lib: ['lib-rows'],
    });
  });
  it.each(ORGS_KINDS)('routes %s to the apps battery alone', (kind: string) => {
    expect(batteryFor(kind)).toEqual({ component: [], findings: [], wake: [], agentTasks: [], partyLabel: [], pages: [], apps: [kind], lib: [] });
  });
  // portal#2514: the untitled-ellipsis rule is on for a named list of kinds; every one must be a real kind, and the two
  // memories tables whose titles #2510 added are on it (a title-removal mutant must turn them red).
  it('TITLE_CHECKED_KINDS names real kinds and includes the memories tables', () => {
    for (const kind of TITLE_CHECKED_KINDS) expect(KINDS, kind).toContain(kind);
    expect(TITLE_CHECKED_KINDS).toEqual(expect.arrayContaining(['orgs-memories-org', 'orgs-memories-subscriptions']));
  });
  // portal#2514: the kind list and the fixture's mount table are two copies of one list, and the fixture type is a third.
  // The fixture's own list is read as text (importing it would mount the route pages in the node lane).
  it('the Orgs fixture mounts exactly the ORGS_KINDS, and dispatches every one', () => {
    const source = readFileSync(new URL('../../src/lib/test/fixtures/orgs-cell-fixtures.ts', import.meta.url), 'utf8');
    const listed = [...(source.match(/export const ORGS_CELL_KINDS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'(orgs-[a-z-]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...ORGS_KINDS].sort());
    const dispatch = source.slice(source.indexOf('export async function mountOrgsCellFixture'));
    const memoryTabs = source.slice(source.indexOf('const MEMORY_TABS'), source.indexOf('async function mountMemories'));
    for (const kind of ORGS_KINDS) expect(dispatch + memoryTabs, kind).toContain(`'${kind}'`);
  });
  // portal#2516: the lib battery's own route, asserted like the Orgs one (it was the one kind with no direct pin).
  it('routes lib-rows to the lib battery alone', () => {
    expect(batteryFor('lib-rows')).toEqual({ component: [], findings: [], wake: [], agentTasks: [], partyLabel: [], pages: [], apps: [], lib: ['lib-rows'] });
  });
  it('rejects a kind outside the accepted set', () => {
    expect(() => batteryFor('edge-removals')).toThrow('batteryFor: unknown kind "edge-removals"');
  });
});

// portal#2506 (delta review): the party-label battery's success line printed its
// 120px-column claim on EVERY leg, including the ones whose width never runs that
// probe — the 390 legs at the default widths, and every leg under a CELL_WIDTH
// override. A line that asserts what no leg measured is how a regression ships
// green behind a log saying the opposite, so the gate and the wording share one table.
describe('partyNarrowProbeNote', () => {
  it('claims the 120px column only at the width whose legs run the probe', () => {
    expect(partyNarrowProbeNote(PARTY_NARROW_PROBE_WIDTH)).toBe(PARTY_NARROW_CLAIM);
  });
  it.each([390, 1024, 1281, 3900])('at %spx the probe does not run, and the line says so instead of claiming it', width => {
    const note = partyNarrowProbeNote(width);
    expect(note).not.toContain('contained in the 120px');
    expect(note).toContain('NOT probed');
    expect(note).toContain(`${width}px`);
  });
  // Source-text tripwire, like the one in cell-harness-messages.test.ts: the claim
  // lives here only. A reformat of the two pinned call shapes trips it on purpose;
  // update the expectation with the reformat, never delete the guard.
  it('the layout script gates the probe and words the line from this table, and holds no inline copy of the claim', () => {
    const script = readFileSync(new URL('../test-table-cell-overflow-layout.mjs', import.meta.url), 'utf8');
    expect(script).toContain('width === PARTY_NARROW_PROBE_WIDTH)');
    expect(script).toContain('${partyNarrowProbeNote(width)}');
    expect(script).not.toContain('contained in the 120px');
  });
});
