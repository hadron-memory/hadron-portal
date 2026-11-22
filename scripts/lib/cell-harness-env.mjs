// portal#2129 rows 1, 6, 8: validate every harness env knob before the dev server or a browser starts.
// portal#2490: the kinds split into batteries — the component mount (alarms,
// runs, config), findings, wake and agent-tasks (each a battery of its own:
// injection knobs / a different oracle; agent-tasks joined from portal#2502;
// wake unioned from main's #2501 in #2507's carry), the six route-page kinds
// of slice 4 (a mounted real page), and the eight Apps route pages (portal#2488,
// unioned from main in #2507's carry: real apps pages with the escape-probe
// oracle). KINDS is derived so CELL_KIND's accepted set and the batteries' kind
// lists cannot drift, and batteryFor is the ONE routing table: the script never
// writes a kind list of its own.
export const APPS_KINDS = ['apps-staff', 'apps-agents', 'apps-keys', 'apps-mine', 'apps-secrets', 'apps-stops', 'apps-tickers', 'apps-tasks'];
// Not exported (blind review #2507, fold): nothing imports it — the tests build
// ALL_KINDS literally and import KINDS/PAGE_KINDS/APPS_KINDS, the script imports
// only parseHarnessEnv/injectionEcho/batteryFor. KINDS derives from it below.
const COMPONENT_KINDS = ['alarms', 'runs', 'config', 'findings', 'wake', 'agent-tasks'];
// portal#2491: the six Orgs route tables (#1962 slice 5) and three more, one kind per table. They are mounted real
// route pages probed by the same escape-probe oracle as the Apps kinds, so they ride the apps battery.
export const ORGS_KINDS = ['orgs-mine', 'orgs-apps', 'orgs-members', 'orgs-runs', 'orgs-agents', 'orgs-subscribed-agents', 'orgs-memories-personal', 'orgs-memories', 'orgs-memories-subscriptions'];
export const PAGE_KINDS = ['agents-mine', 'memories-mine', 'agent-apps', 'agent-bundled', 'node-properties', 'node-history'];
export const KINDS = [...COMPONENT_KINDS, ...PAGE_KINDS, ...APPS_KINDS, ...ORGS_KINDS];
// The component battery's own kinds: findings, wake and agent-tasks are
// COMPONENT_KINDS (CELL_KIND accepts them) but mount through their own
// batteries, not this one.
const COMPONENT_BATTERY_KINDS = ['alarms', 'runs', 'config'];
// Which battery owns a CELL_KIND, and with which kinds (blind review, #2507):
// null runs every battery at its full list; any specific kind routes to exactly
// ONE battery. The pages list in the script once ran all six page kinds for ANY
// non-page kind — a single-kind run dragged in every page leg (and the node
// loader and fetch guard) — because the routing lived in three hand-written
// conditionals. It lives here now, pinned by a table test. The Apps kinds
// (main's #2488 slice) are a page-mount battery of their own: they run the
// escape-probe oracle, not the six-kind pages battery's geometry walker.
export function batteryFor(cellKind) {
  if (cellKind === null) {
    // Copies, not the module constants (blind review #2507, fold): the per-kind
    // arms below build fresh literals, and a caller mutating the null result's
    // arrays must not corrupt the constants every later call reads.
    return { component: [...COMPONENT_BATTERY_KINDS], findings: ['findings'], wake: ['wake'], agentTasks: ['agent-tasks'], pages: [...PAGE_KINDS], apps: [...APPS_KINDS, ...ORGS_KINDS] };
  }
  if (cellKind === 'findings') return { component: [], findings: ['findings'], wake: [], agentTasks: [], pages: [], apps: [] };
  if (cellKind === 'wake') return { component: [], findings: [], wake: ['wake'], agentTasks: [], pages: [], apps: [] };
  if (cellKind === 'agent-tasks') return { component: [], findings: [], wake: [], agentTasks: ['agent-tasks'], pages: [], apps: [] };
  if (PAGE_KINDS.includes(cellKind)) return { component: [], findings: [], wake: [], agentTasks: [], pages: [cellKind], apps: [] };
  if (APPS_KINDS.includes(cellKind) || ORGS_KINDS.includes(cellKind)) return { component: [], findings: [], wake: [], agentTasks: [], pages: [], apps: [cellKind] };
  if (COMPONENT_BATTERY_KINDS.includes(cellKind)) return { component: [cellKind], findings: [], wake: [], agentTasks: [], pages: [], apps: [] };
  throw new Error(`batteryFor: unknown kind ${JSON.stringify(cellKind)} — parseHarnessEnv validates the accepted set first`);
}
const flag = (env, name) => {
  if (!(name in env) || env[name] === undefined) return false;
  if (env[name] !== '0' && env[name] !== '1') throw new Error(`${name} must be 0 or 1 when set, got ${JSON.stringify(env[name])}`);
  return env[name] === '1';
};
export function parseHarnessEnv(env) {
  let cellWidth = null;
  if (env.CELL_WIDTH !== undefined) {
    if (!/^[1-9][0-9]{0,4}$/.test(env.CELL_WIDTH)) throw new Error(`CELL_WIDTH must be a whole number of pixels from 1 to 99999, got ${JSON.stringify(env.CELL_WIDTH)}`);
    cellWidth = Number(env.CELL_WIDTH);
  }
  let cellKind = null;
  if (env.CELL_KIND !== undefined) {
    if (!KINDS.includes(env.CELL_KIND)) throw new Error(`CELL_KIND must be one of ${KINDS.join(', ')}, got ${JSON.stringify(env.CELL_KIND)}`);
    cellKind = env.CELL_KIND;
  }
  const injectPointerFailure = flag(env, 'CELL_INJECT_POINTER_FAILURE');
  const injectMissingTrigger = flag(env, 'CELL_INJECT_MISSING_TRIGGER');
  // Both injections act only in the findings leg. Selecting another kind would announce a failure that cannot happen.
  for (const [name, on] of [['CELL_INJECT_POINTER_FAILURE', injectPointerFailure], ['CELL_INJECT_MISSING_TRIGGER', injectMissingTrigger]]) {
    if (on && cellKind !== null && cellKind !== 'findings') throw new Error(`${name}=1 only acts on the findings leg, got CELL_KIND=${JSON.stringify(cellKind)}`);
  }
  return { cellWidth, cellKind, injectPointerFailure, injectMissingTrigger };
}
// One line per knob that is exactly 1; silent for unset and 0.
export function injectionEcho(parsed) {
  return [
    parsed.injectPointerFailure && 'CELL_INJECT_POINTER_FAILURE',
    parsed.injectMissingTrigger && 'CELL_INJECT_MISSING_TRIGGER',
  ].filter(Boolean).map(name => `INJECTION ACTIVE: ${name}=1 (this run is expected to fail)`);
}
